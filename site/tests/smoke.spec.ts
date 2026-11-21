import { expect, test } from "@playwright/test";

const HOME = "/plumbline/";
const WIDTHS = [1440, 1280, 1024, 768, 375];

for (const width of WIDTHS) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("has no horizontal page scroll", async ({ page }) => {
      for (const path of [HOME, `${HOME}docs/`, `${HOME}docs/contract/`, `${HOME}changelog/`]) {
        await page.goto(path);
        await page.evaluate(() => document.fonts.ready);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, path).toBeLessThanOrEqual(0);
      }
    });

    test("no element sticks out past the page", async ({ page }) => {
      await page.goto(HOME);
      await page.evaluate(() => document.fonts.ready);
      const offenders = await page.evaluate(() => {
        const limit = document.documentElement.clientWidth;
        return [...document.querySelectorAll<HTMLElement>("main p, main h1, main h2, main h3, main table, main figure, main li")]
          .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().right > limit + 1)
          .map((el) => `${el.tagName}: ${(el.textContent ?? "").slice(0, 40)}`);
      });
      expect(offenders).toEqual([]);
    });

    test("the copy button stays inside the install box", async ({ page }) => {
      await page.goto(HOME);
      await page.evaluate(() => document.fonts.ready);
      const box = await page.locator(".install").boundingBox();
      const button = await page.getByRole("button", { name: "Copy install command" }).boundingBox();
      expect(button!.x + button!.width).toBeLessThanOrEqual(box!.x + box!.width);
    });

    test("nav items do not overlap", async ({ page }) => {
      await page.goto(HOME);
      await page.evaluate(() => document.fonts.ready);
      const clash = await page.evaluate(() => {
        const items = [...document.querySelectorAll<HTMLElement>("header .logo, header nav li a, header .actions a, header .toggle")]
          .filter((el) => el.offsetParent !== null)
          .map((el) => el.getBoundingClientRect());
        return items.some((a, i) => items.some((b, j) => j > i && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom));
      });
      expect(clash).toBe(false);
    });
  });
}

test.describe("structure", () => {
  test("has one h1, labelled sections and labelled drawings", async ({ page }) => {
    await page.goto(HOME);
    await expect(page.locator("h1")).toHaveCount(1);
    for (const section of await page.locator("main section").all()) {
      const id = await section.getAttribute("aria-labelledby");
      expect(id).toBeTruthy();
      await expect(page.locator(`[id="${id}"]`)).toHaveCount(1);
    }
    for (const svg of await page.locator('main svg[role="img"]').all()) {
      expect(await svg.getAttribute("aria-label")).toBeTruthy();
    }
  });

  test("meta tags are set", async ({ page }) => {
    await page.goto(HOME);
    await expect(page).toHaveTitle("Plumbline — review the structure, not just the diff");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://tanzir71.github.io/plumbline/");
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://tanzir71.github.io/plumbline/og.png");
    const og = await page.request.get(`${HOME}og.png`);
    expect(og.ok()).toBe(true);
  });

  test("footer credits tanziro.com", async ({ page }) => {
    await page.goto(HOME);
    await expect(page.locator("footer .bottom a")).toHaveAttribute("href", "https://tanziro.com");
    await expect(page.locator("footer .bottom")).toContainText("Built by tanziro.com");
  });

  test("the 404 page works", async ({ page }) => {
    const res = await page.goto(`${HOME}no-such-page/`);
    expect(res?.status()).toBe(404);
    await expect(page.locator("h1")).toContainText("out of plumb");
  });

  test("uses self-hosted fonts only", async ({ page }) => {
    const external: string[] = [];
    page.on("request", (r) => {
      if (!r.url().startsWith("http://localhost") && !r.url().startsWith("data:")) external.push(r.url());
    });
    await page.goto(HOME);
    await page.evaluate(() => document.fonts.ready);
    expect(external).toEqual([]);
    const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family));
    expect(loaded).toEqual(expect.arrayContaining(["Geist", "Geist Mono"]));
  });

  test("components have no gradients or shadows", async ({ page }) => {
    await page.goto(HOME);
    const bad = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("body *")]
        .filter((el) => {
          const s = getComputedStyle(el);
          return s.backgroundImage.includes("gradient") || s.boxShadow !== "none" || s.textShadow !== "none";
        })
        .map((el) => el.className || el.tagName),
    );
    expect(bad).toEqual([]);
  });

  test("glow appears only behind the hero shot and the teams box", async ({ page }) => {
    await page.goto(HOME);
    const glows = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("body *")]
        .filter((el) => getComputedStyle(el, "::before").backgroundImage.includes("radial-gradient"))
        .map((el) => el.classList[0]),
    );
    expect(glows.sort()).toEqual(["box-wrap", "shot-wrap"]);
  });

  test("cards, panels, buttons and the nav have no strokes", async ({ page }) => {
    await page.goto(HOME);
    const bad = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".btn, .finding, .panel, .card, .box, .shot, header.nav, .node, .calc")]
        .filter((el) => getComputedStyle(el).borderTopWidth !== "0px")
        .map((el) => el.className),
    );
    expect(bad).toEqual([]);
  });
});

test.describe("interactions", () => {
  test("copy button copies and announces", async ({ page }) => {
    await page.goto(HOME);
    await page.getByRole("button", { name: "Copy install command" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#copy-status")).toHaveText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("npx skills add tanzir71/plumbline -g");
  });

  test("install tabs work by keyboard", async ({ page }) => {
    await page.goto(HOME);
    await page.getByRole("tab", { name: "Skill" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "GitHub Action" })).toBeFocused();
    await expect(page.getByRole("tabpanel")).toContainText("tanzir71/plumbline@v1");
    await page.keyboard.press("End");
    await expect(page.getByRole("tabpanel")).toContainText("@tanziro/plumbline");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Skill" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("tab", { name: "MCP server" })).toHaveAttribute("aria-selected", "true");
  });

  test("cost calculator recomputes by keyboard", async ({ page }) => {
    await page.goto(HOME);
    const toggle = page.getByRole("button", { name: "Run the numbers for your team" });
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator('input[name="developers"]')).toBeFocused();

    await page.locator('input[name="developers"]').fill("10");
    await page.locator('input[name="prsPerMonth"]').fill("100");
    await page.locator('input[name="reviewsPerPr"]').fill("2");
    await page.locator('select[name="billing"]').selectOption("monthly");

    const row = (id: string, field: string) => page.locator(`tr[data-vendor="${id}"] [data-field="${field}"]`);
    await expect(row("claude-code-review", "perMonth")).toHaveText("$3,000–5,000");
    await expect(row("claude-code-review", "perYear")).toHaveText("$36k–60k");
    const perCredit = page.locator("#cost tbody tr").nth(1);
    await expect(perCredit.locator('[data-field="perMonth"]')).toHaveText("$200–600");
    await expect(row("coderabbit-essentials", "perMonth")).toHaveText("$300");
    await expect(row("coderabbit-essentials", "perYear")).toHaveText("$3.6k");
    await expect(row("coderabbit-essentials", "pricing")).toHaveText("$30 per developer, billed monthly");
    await expect(row("plumbline", "perMonth")).toHaveText("$0");
    await expect(page.locator("#cost-skipped")).toHaveText("$2.4k–60k");
    await expect(page.locator("#calc-result")).toContainText("Plumbline: $0");
  });

  test("default cost figures match the design", async ({ page }) => {
    await page.goto(HOME);
    const row = (id: string, field: string) => page.locator(`tr[data-vendor="${id}"] [data-field="${field}"]`);
    await expect(row("claude-code-review", "perMonth")).toHaveText("$7,500–12,500");
    await expect(row("claude-code-review", "perYear")).toHaveText("$90k–150k");
    await expect(page.locator("#cost tbody tr").nth(1).locator('[data-field="perYear"]')).toHaveText("$6k–18k");
    await expect(row("coderabbit-essentials", "perYear")).toHaveText("$7.2k");
    await expect(page.locator("#cost-skipped")).toHaveText("$6k–150k");
  });

  test.describe("mobile nav", () => {
    test.use({ viewport: { width: 375, height: 800 } });

    test("opens, closes with Escape and returns focus", async ({ page }) => {
      await page.goto(HOME);
      const toggle = page.getByRole("button", { name: "Open menu" });
      await toggle.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#site-menu")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator("#site-menu")).toBeHidden();
      await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();
    });
  });
});
