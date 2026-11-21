import { save } from "../db/client.js";

export const createOrg = (x) => save(x);
