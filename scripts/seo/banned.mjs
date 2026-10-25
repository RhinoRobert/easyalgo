// A name this site chose never to publish. Built from pieces so the name itself is not written anywhere in the source.
export const BANNED = new RegExp(`${["rug", "ninja"].join("\\.?\\s?")}|${["rug", "inja"].join("")}`, "i");
export const isBanned = (...texts) => texts.some((text) => BANNED.test(String(text ?? "")));
