import { getEnv } from "../src/lib/env.js";

getEnv();
const keys = Object.keys(process.env)
  .filter((k) => /^(GITHUB_|SMTP_|EMAIL_)/i.test(k))
  .sort();
console.log(JSON.stringify({ keys }, null, 2));
