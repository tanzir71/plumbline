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

  for (const path of [HOME, `${HOME}docs/`, `${HOME}changelog/`, `${HOME}no-such-page/`]) {
    test(`favicons load on ${path}`, async ({ page }) => {
      await page.goto(path);
      const icons = await page.locator('link[rel="icon"], link[rel="apple-touch-icon"]').evaluateAll((els) =>
        els.map((el) => (el as HTMLLinkElement).href),
      );
      expect(icons).toHaveLength(3);
      const types: string[] = [];
      for (const href of icons) {
        expect(new URL(href).pathname.startsWith(HOME), href).toBe(true);
        const res = await page.request.get(href);
        expect(res.ok(), href).toBe(true);
        expect((await res.body()).length, href).toBeGreaterThan(100);
        types.push(res.headers()["content-type"] ?? "");
      }
      expect(types.join(" ")).toContain("svg");
      expect(types.join(" ")).toContain("png");
    });
  }

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
        // The mesh is the one background layer allowed to use gradients.
        .filter((el) => !el.closest(".glow-mesh"))
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
    const { hosts, stray } = await page.evaluate(() => ({
      hosts: [...document.querySelectorAll<HTMLElement>(".glow-mesh")].map((el) => el.parentElement?.classList[0]),
      stray: [...document.querySelectorAll<HTMLElement>("body *")]
        .filter((el) => !el.closest(".glow-mesh, .pipeline, .path"))
        .filter((el) => ["::before", "::after"].some((p) => getComputedStyle(el, p).backgroundImage.includes("gradient")))
        .map((el) => el.className || el.tagName),
    }));
    expect(hosts.sort()).toEqual(["box-wrap", "shot-wrap"]);
    expect(stray).toEqual([]);
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

const running = (page: import("@playwright/test").Page) =>
  page.evaluate(() =>
    document.getAnimations().map((a) => {
      const effect = a.effect as KeyframeEffect;
      return {
        name: (a as CSSAnimation).animationName ?? "",
        state: a.playState,
        props: [...new Set(effect.getKeyframes().flatMap((k) => Object.keys(k)))].filter(
          (p) => !["offset", "computedOffset", "easing", "composite"].includes(p),
        ),
      };
    }),
  );

test.describe("motion", () => {
  test("the glows and all four diagrams animate", async ({ page }) => {
    await page.goto(HOME);
    const names = new Set((await running(page)).map((a) => a.name));
    for (const name of ["mesh-orbit", "mesh-sway", "mesh-turn", "mesh-stretch", "mesh-colour", "beam-run", "beam-x", "beam-y"]) {
      expect(names, name).toContain(name);
    }
  });

  test("diagram lines stay solid at every scroll position and moment", async ({ page }) => {
    await page.goto(HOME);
    await expect(page.locator(".edge-solid")).toHaveCount(5);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let step = 0; step <= 12; step++) {
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), (height * step) / 12);
      await page.waitForTimeout(90);
      const broken = await page.evaluate(() =>
        [...document.querySelectorAll<SVGElement>(".edge-solid")].filter((el) => {
          const s = getComputedStyle(el);
          return el.getAnimations().length > 0 || s.opacity !== "1" || s.strokeDasharray !== "none" || s.visibility !== "visible";
        }).length,
      );
      expect(broken, `at scroll step ${step}`).toBe(0);
    }
  });

  test("the line gradients run exactly along their lines", async ({ page }) => {
    await page.goto(HOME);
    const out = await page.evaluate(() => {
      const signals = [...document.querySelectorAll<SVGGElement>("g.signal")];
      const off: string[] = [];
      for (const signal of signals) {
        const d = signal.querySelector("mask path")!.getAttribute("d")!;
        const drawn = [...signal.ownerSVGElement!.querySelectorAll("path")].filter((p) => !p.closest("mask"));
        const spots = [...signal.querySelectorAll<SVGElement>(".spot")];
        if (!drawn.some((p) => p.getAttribute("d") === d)) off.push(`no drawn edge for ${d}`);
        if (spots.length !== 2 || spots.some((s) => getComputedStyle(s).offsetPath === "none" || !s.getAttribute("style")!.includes(d))) off.push(`spots off ${d}`);
      }
      return { count: signals.length, off, dots: document.querySelectorAll(".pulse, .edge-dot, .ripple").length };
    });
    expect(out).toEqual({ count: 10, off: [], dots: 0 });
  });

  test("the mesh changes between cool palette colours and stays behind its panel", async ({ page }) => {
    await page.goto(HOME);
    const meshes = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".glow-mesh")].map((mesh) => {
        const panel = mesh.parentElement?.querySelector(".shot, .box") as HTMLElement;
        const colours = [...mesh.querySelectorAll(".lobe")].map((lobe) => {
          const m = getComputedStyle(lobe).backgroundImage.match(/rgba?\((\d+), (\d+), (\d+)/);
          return m ? `${m[1]},${m[2]},${m[3]}` : "none";
        });
        return {
          z: getComputedStyle(mesh).zIndex,
          before: Boolean(mesh.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING),
          panelBackground: getComputedStyle(panel).backgroundColor,
          colours,
        };
      }),
    );
    expect(meshes).toHaveLength(2);
    const palette = ["110,231,200", "143,162,255", "183,155,255"];
    for (const mesh of meshes) {
      expect(mesh.z).toBe("-1");
      expect(mesh.before).toBe(true);
      expect(mesh.panelBackground).toMatch(/^rgb\(/);
      expect(new Set(mesh.colours)).toEqual(new Set(palette));
    }
  });

  test("the light stays in a tight halo around each box", async ({ page }) => {
    await page.goto(HOME);
    const past = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".glow-mesh")].map((mesh) => {
        const box = mesh.getBoundingClientRect();
        const field = mesh.querySelector(".field")!.getBoundingClientRect();
        return Math.max(box.top - field.top, field.right - box.right, field.bottom - box.bottom, box.left - field.left);
      }),
    );
    expect(past).toHaveLength(2);
    for (const px of past) expect(px).toBeLessThanOrEqual(92);
  });

  test("the mesh travels around all four edges of each box", async ({ page }) => {
    await page.goto(HOME);
    const meshes = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".glow-mesh")].map((mesh) => {
        const blob = mesh.querySelector<HTMLElement>(".blob")!;
        const orbit = blob.getAnimations().find((a) => (a as CSSAnimation).animationName === "mesh-orbit")!;
        orbit.pause();
        const duration = orbit.effect!.getComputedTiming().duration as number;
        const box = mesh.getBoundingClientRect();
        const inset = parseFloat(getComputedStyle(mesh).getPropertyValue("--inset"));
        const sides = new Set<string>();
        let offEdge = 0;
        for (let i = 0; i < 64; i++) {
          orbit.currentTime = (duration * i) / 64;
          const r = blob.getBoundingClientRect();
          const x = r.left + r.width / 2 - box.left;
          const y = r.top + r.height / 2 - box.top;
          const on = [
            Math.abs(y - inset) < 2 && "top",
            Math.abs(x - (box.width - inset)) < 2 && "right",
            Math.abs(y - (box.height - inset)) < 2 && "bottom",
            Math.abs(x - inset) < 2 && "left",
          ].filter(Boolean) as string[];
          if (on.length === 0) offEdge++;
          on.forEach((side) => sides.add(side));
        }
        orbit.play();
        return { sides: [...sides].sort(), offEdge };
      }),
    );
    expect(meshes).toHaveLength(2);
    for (const mesh of meshes) {
      expect(mesh.sides).toEqual(["bottom", "left", "right", "top"]);
      expect(mesh.offEdge).toBe(0);
    }
  });

  test("animates only cheap properties, so it cannot shift the layout", async ({ page }) => {
    await page.goto(HOME);
    const allowed = new Set(["transform", "opacity", "translate", "rotate", "scale", "filter", "offsetDistance"]);
    for (const a of await running(page)) {
      if (!a.name) continue;
      for (const prop of a.props) expect(allowed, `${a.name}: ${prop}`).toContain(prop);
    }
  });

  test("the pause control stops motion, by keyboard", async ({ page }) => {
    await page.goto(HOME);
    const toggle = page.getByRole("checkbox", { name: "Pause motion" });
    await toggle.focus();
    await page.keyboard.press("Space");
    await expect(page.locator(".motion-toggle")).toContainText("Play motion");
    await expect.poll(async () => (await running(page)).filter((a) => a.name.includes("mesh") && a.state === "running").length).toBe(0);
    await page.keyboard.press("Space");
    await expect.poll(async () => (await running(page)).filter((a) => a.name.includes("mesh") && a.state === "running").length).toBeGreaterThan(0);
  });

  test("scroll reveals finish in view, and pausing never leaves content hidden", async ({ page }) => {
    await page.goto(HOME);
    const panel = page.locator("#install .panel");
    await panel.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy({ top: 240, behavior: "instant" }));
    await expect.poll(() => panel.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.getByRole("checkbox", { name: "Pause motion" }).check({ force: true });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expect.poll(() => panel.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  });

  test("the tab indicator follows the selected tab", async ({ page }) => {
    await page.goto(HOME);
    const list = page.getByRole("tablist", { name: "Install options" });
    const offset = () => list.evaluate((el) => parseFloat(el.style.getPropertyValue("--x")));
    const first = await offset();
    await page.getByRole("tab", { name: "GitLab CI" }).click();
    const tabLeft = await page.getByRole("tab", { name: "GitLab CI" }).evaluate((el) => (el as HTMLElement).offsetLeft);
    expect(await offset()).toBe(tabLeft);
    expect(tabLeft).toBeGreaterThan(first);
  });

  test.describe("with reduced motion", () => {
    test.use({ contextOptions: { reducedMotion: "reduce" } });

    test("nothing animates, every edge is visible and the control is hidden", async ({ page }) => {
      await page.goto(HOME);
      expect((await running(page)).filter((a) => a.name)).toEqual([]);
      await expect(page.locator(".motion-toggle")).toBeHidden();
      for (const blob of await page.locator(".glow-mesh .blob").all()) {
        expect(await blob.evaluate((el) => getComputedStyle(el).transform)).toMatch(/^matrix/);
      }
      for (const lobe of await page.locator(".glow-mesh .lobe").all()) {
        expect(await lobe.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
      }
      for (const spot of await page.locator(".signal .spot").all()) {
        expect(await spot.evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
      }
    });
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

  test("field test shows aggregate Plumbline counts with its limits", async ({ page }) => {
    await page.goto(HOME);
    const section = page.locator("#benchmark");
    const text = (await section.innerText()).replace(/\s+/g, " ");
    expect(text).toContain("12 merged PRs");
    expect(text).toContain("This is not an accuracy measurement.");
    expect(text).not.toMatch(/competitor|precision|catch rate/i);
    const vendors = (await page.locator("#cost tbody th").allInnerTexts()).map((name) => name.split("\n")[0]?.trim() ?? "").filter((name) => name && !/plumbline/i.test(name));
    expect(vendors.length).toBeGreaterThan(0);
    for (const vendor of vendors) expect(text.toLowerCase()).not.toContain(vendor.toLowerCase());
    await expect(section.locator(".ledger tbody tr")).toHaveCount(4);
  });

  test("install starts with copyable beginner steps", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(HOME);
    await expect(page.getByRole("tab", { name: "Start here" })).toHaveAttribute("aria-selected", "true");
    const panel = page.getByRole("tabpanel");
    await expect(panel.locator(".quick > li")).toHaveCount(5);
    await expect(panel).toContainText("npm install -g @tanziro/plumbline");
    await expect(panel).toContainText("plumbline review");
    await panel.getByRole("button", { name: "Copy npm install -g @tanziro/plumbline" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("npm install -g @tanziro/plumbline");
    await expect(page.locator("#install a[href$='docs/getting-started/']").first()).toBeVisible();
  });

  test("install tabs work by keyboard", async ({ page }) => {
    await page.goto(HOME);
    await page.getByRole("tab", { name: "Start here" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Skill" })).toBeFocused();
    await expect(page.getByRole("tabpanel")).toContainText("/plumbline review");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "GitHub Action" })).toBeFocused();
    await expect(page.getByRole("tabpanel")).toContainText("tanzir71/plumbline@v1");
    await page.keyboard.press("End");
    await expect(page.getByRole("tabpanel")).toContainText("@tanziro/plumbline");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Start here" })).toHaveAttribute("aria-selected", "true");
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
