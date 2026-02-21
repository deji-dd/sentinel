// Test file to visualize verification DM messages

// Sample guild name
const guildName = "Example Discord Server";

console.log("=".repeat(60));
console.log("VERIFICATION DM SAMPLES");
console.log("=".repeat(60));

// SUCCESS MESSAGE
console.log("\n1️⃣ SUCCESS MESSAGE (User successfully verified)");
console.log("-".repeat(60));
const successEmbed = {
  color: 0x22c55e,
  title: "✅ Automatically Verified",
  description: `Welcome to **${guildName}**! You've been automatically verified.`,
  fields: [
    { name: "Torn Name", value: "John Doe", inline: true },
    { name: "Torn ID", value: "123456", inline: true },
    { name: "Faction", value: "Epic Mafia [EM]", inline: true },
  ],
};

console.log(JSON.stringify(successEmbed, null, 2));

// NOT LINKED MESSAGE
console.log("\n2️⃣ NOT LINKED MESSAGE (Discord not linked to Torn account)");
console.log("-".repeat(60));
const notLinkedEmbed = {
  color: 0xef4444,
  title: "❌ Not Linked to Torn",
  description: `Your Discord account is not linked to a Torn account. Visit **https://www.torn.com/preferences.php** to link your account.`,
  fields: [],
};

console.log(JSON.stringify(notLinkedEmbed, null, 2));

// ERROR MESSAGE
console.log("\n3️⃣ ERROR MESSAGE (API error or other issue)");
console.log("-".repeat(60));
const errorEmbed = {
  color: 0xef4444,
  title: "❌ Verification Failed",
  description: `An error occurred while verifying your account: **API rate limit exceeded**. Please try the /verify command manually.`,
  fields: [],
};

console.log(JSON.stringify(errorEmbed, null, 2));

console.log("\n" + "=".repeat(60));
console.log("VISUAL PREVIEW");
console.log("=".repeat(60));

console.log("\n✅ SUCCESS:");
console.log(`
┌─ Automatically Verified
│
│ Welcome to Example Discord Server! You've been automatically verified.
│
│ Torn Name: John Doe          Torn ID: 123456
│ Faction: Epic Mafia [EM]
└─
`);

console.log("❌ NOT LINKED:");
console.log(`
┌─ Not Linked to Torn
│
│ Your Discord account is not linked to a Torn account. 
│ Visit https://www.torn.com/preferences.php to link your account.
│
└─
`);

console.log("❌ ERROR:");
console.log(`
┌─ Verification Failed
│
│ An error occurred while verifying your account: API rate limit exceeded.
│ Please try the /verify command manually.
│
└─
`);
