import fs from "fs";
const file = fs.readFileSync("src/services/worker-inbox-reply-service.ts", "utf8");
console.log(file.includes("ProviderRunner"));
