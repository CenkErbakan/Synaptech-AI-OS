import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const envPath = path.join(root, ".env");
let text = fs.readFileSync(envPath, "utf8");
text = text.replaceAll("127.0.0.1:14333", "localhost:14333");
text = text.replaceAll("server: \"127.0.0.1\"", 'server: "localhost"');
fs.writeFileSync(envPath, text);
console.log("DATABASE host → localhost");
