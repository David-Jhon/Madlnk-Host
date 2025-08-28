const axios = require("axios");
const cheerio = require("cheerio");
const Nhentai = require("../DB/nhentai");
const FormData = require("form-data");
const { createTelegraPage, processImagesForTelegra } = require("../utilities/telegraUtils");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadDoujin(doujinId) {
  const url = `https://nhentai.net/api/gallery/${encodeURIComponent(doujinId)}`;
  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "accept-encoding": "gzip, deflate, br, zstd",
        "accept-language": "en-US,en;q=0.9",
        "sec-ch-ua": `"Chromium";v="128", "Not;A=Brand";v="24", "Brave";v="128"`,
        "sec-fetch-mode": "navigate",
        Cookie: "csrftoken=QCNUqWsg8rTJfZEWmoFxEj1MygROS4bf",
      },
    });
    const doujin = response.data;
    const media_id = doujin.media_id;
    const imageUrls = doujin.images.pages.map((page, index) => {
      let ext = page.t === "j" ? "jpg" : "png";
      return `https://i7.nhentai.net/galleries/${encodeURIComponent(media_id)}/${index + 1}.${ext}`;
    });
    const coverExt = doujin.images.cover.t === "j" ? "jpg" : "png";
    const coverUrl = `https://t3.nhentai.net/galleries/${encodeURIComponent(media_id)}/cover.${coverExt}`;
    const extractTags = (type) =>
      doujin.tags.filter((tag) => tag.type === type).map((tag) => tag.name).join(", ");
    return {
      title: doujin.title,
      id: doujin.id,
      media_id,
      pages: doujin.images.pages.length,
      language: doujin.tags.find((tag) => tag.type === "language")?.name || "Unknown",
      tags: doujin.tags.filter((tag) => tag.type === "tag").map((tag) => tag.name).slice(0, 20),
      cover: coverUrl,
      coverExt: doujin.images.cover.t === "j" ? "jpg" : "png",
      imageUrls,
      parodies: extractTags("parody"),
      characters: extractTags("character"),
      artists: extractTags("artist"),
      groups: extractTags("group"),
      languages: extractTags("language"),
      categories: extractTags("category"),
    };
  } catch (error) {
    console.error("Failed to fetch doujin info:", error.message);
    return null;
  }
}

async function handleNhentaiCommand(chatId, doujinId, bot) {
  const existingDoujin = await Nhentai.findOne({ doujinId });
  if (existingDoujin) {
    let readOnlineLinks = "";
    if (existingDoujin.previews.telegraph_urls && Array.isArray(existingDoujin.previews.telegraph_urls)) {
      if (existingDoujin.previews.telegraph_urls.length === 1) {
        readOnlineLinks = `[View on Telegraph](${existingDoujin.previews.telegraph_urls[0]})`;
      } else {
        readOnlineLinks = existingDoujin.previews.telegraph_urls
          .map((url, index) => `[View Part ${index + 1} on Telegraph](${url})`)
          .join("\n➤ ");
      }
    }
    await bot.sendPhoto(chatId, existingDoujin.thumbnail, {
      caption: `
*Doujin ID*: #\`${existingDoujin.doujinId}\`
*Media ID*: \`${existingDoujin.mediaId}\`
*Title (English)*: \`${existingDoujin.title.english || "N/A"}\`
*Title (Japanese)*: \`${existingDoujin.title.japanese || "N/A"}\`
*Title (Pretty)*: \`${existingDoujin.title.pretty || "N/A"}\`
*Parodies*: ${existingDoujin.parodies || "N/A"}
*Characters*: ${existingDoujin.characters || "N/A"}
*Tags*: ${existingDoujin.tags.join(", ")}
*Artists*: ${existingDoujin.artists || "N/A"}
*Groups*: ${existingDoujin.groups || "N/A"}
*Languages*: ${existingDoujin.languages || "N/A"}
*Categories*: ${existingDoujin.categories || "N/A"}
*Total Pages*: ${existingDoujin.pages}
*Read online*: ➤ ${readOnlineLinks}
`,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[{ text: "📥 Download", callback_data: `nhentai:download:${existingDoujin.doujinId}` }]],
      },
    });
    return;
  }
  const doujin = await downloadDoujin(doujinId);
  if (!doujin) {
    await bot.sendMessage(
      chatId,
      `Failed to retrieve doujin information for ID: \`${doujinId}\`. Please check if the ID is correct.`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[{ text: "Link", url: `https://nhentai.net/search/?q=${doujinId}` }]],
        },
      }
    );
    return;
  }
  await bot.sendChatAction(chatId, "upload_photo");
  const telegraPageUrls = await processImagesForTelegra(doujin);
  if (telegraPageUrls.length > 0) {
    const newDoujin = new Nhentai({
      doujinId: doujin.id,
      mediaId: doujin.media_id,
      title: doujin.title,
      tags: doujin.tags,
      pages: doujin.pages,
      thumbnail: doujin.cover,
      previews: { telegraph_urls: telegraPageUrls },
      parodies: doujin.parodies,
      characters: doujin.characters,
      artists: doujin.artists,
      groups: doujin.groups,
      languages: doujin.languages,
      categories: doujin.categories,
    });
    await newDoujin.save();
    const readOnlineLinks =
      telegraPageUrls.length === 1
        ? `[View on Telegraph](${telegraPageUrls[0]})`
        : telegraPageUrls.map((url, index) => `[View Part ${index + 1} on Telegraph](${url})`).join("\n➤ ");
    await bot.sendPhoto(chatId, doujin.cover, {
      caption: `
*Doujin ID*: #\`${doujin.id}\`
*Media ID*: \`${doujin.media_id}\`
*Title (English)*: \`${doujin.title.english || "N/A"}\`
*Title (Japanese)*: \`${doujin.title.japanese || "N/A"}\`
*Title (Pretty)*: \`${doujin.title.pretty || "N/A"}\`
*Parodies*: ${doujin.parodies || "N/A"}
*Characters*: ${doujin.characters || "N/A"}
*Tags*: ${doujin.tags.join(", ")}
*Artists*: ${doujin.artists || "N/A"}
*Groups*: ${doujin.groups || "N/A"}
*Languages*: ${doujin.languages || "N/A"}
*Categories*: ${doujin.categories || "N/A"}
*Total Pages*: ${doujin.pages}
*Read online*: ➤ ${readOnlineLinks}
`,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[{ text: "📥 Download", callback_data: `nhentai:download:${doujin.id}` }]],
      },
    });
  } else {
    await bot.sendMessage(chatId, "Failed to create Telegra.ph pages.");
  }
}

async function searchDoujin(query) {
  const baseUrl = "https://nhentai.net/";
  const searchUrl = `https://nhentai.net/search/?q=${encodeURIComponent(query)}&sort=popular`;
  try {
    let response;
    const results = [];
    const headers = { Cookie: "csrftoken=QCNUqWsg8rTJfZEWmoFxEj1MygROS4bf" };
    if (query === "⭐️" || query === "🆕") {
      response = await axios.get(baseUrl, { headers });
      const $ = cheerio.load(response.data);
      const selector = query === "⭐️" ? ".index-container.index-popular .gallery" : ".index-container:not(.index-popular) .gallery";
      $(selector).each((index, element) => {
        if (index < 40) {
          const id = $(element).find("a").attr("href").split("/")[2];
          const title = $(element).find(".caption").text().trim();
          const media_id = $(element).find("a > img").attr("data-src").split("/")[4];
          const isEnglish = title.toLowerCase().includes("english");
          const isChinese = title.toLowerCase().includes("chinese");
          const language = isEnglish ? "English" : isChinese ? "Chinese" : "Japanese";
          results.push({ id, title, language, media_id });
        }
      });
    } else {
      response = await axios.get(searchUrl, { headers });
      const $ = cheerio.load(response.data);
      $(".gallery").each((index, element) => {
        if (index < 40) {
          const id = $(element).find("a").attr("href").split("/")[2];
          const title = $(element).find(".caption").text().trim();
          const media_id = $(element).find("a > img").attr("data-src").split("/")[4];
          const isEnglish = title.toLowerCase().includes("english");
          const isChinese = title.toLowerCase().includes("chinese");
          const language = isEnglish ? "English" : isChinese ? "Chinese" : "Japanese";
          results.push({ id, title, language, media_id });
        }
      });
    }
    return results;
  } catch (error) {
    console.error("Failed to fetch doujinshi:", error.message);
    return [];
  }
}

module.exports = {
  name: "nhentai",
  version: 1.0,
  longDescription: "Fetch and display doujinshi from nhentai.net, with options to view online and download images.",
  shortDescription: "Get detailed info and read doujinshi",
  guide: "{pn} <doujin id>",
  category: ['Download', 4],
  lang: {
    noId: "Please provide the NUKE code! 👀\n\nExample: `/nhentai 123456` or use the search button below.",
    fetchError: "Failed to retrieve doujin information. Please check if the ID is correct.",
    telegraphError: "Failed to create Telegra.ph pages.",
    downloadError: "Failed to download doujin images.",
  },
  
  onStart: async ({ bot, msg, args }) => {
    const chatId = msg.chat.id;
    const doujinId = args[0] ? args[0].trim() : null;
    if (!doujinId) {
      return bot.sendMessage(chatId, module.exports.lang.noId, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔍 Find Doujins", switch_inline_query_current_chat: "" }],
            [
              { text: "⭐ Popular", switch_inline_query_current_chat: "⭐️" },
              { text: "🆕 Newest", switch_inline_query_current_chat: "🆕" },
            ],
          ],
        },
      });
    }
    await handleNhentaiCommand(chatId, doujinId, bot);
  },
  onCallback: async ({ bot, callbackQuery, params }) => {
    const chatId = callbackQuery.message.chat.id;
    const action = params[0];
    if (action === "download") {
      const doujinId = params[1];
      const doujin = await downloadDoujin(doujinId);
      if (doujin) {
        const batchSize = 9;
        const totalPages = doujin.pages;
        for (let i = 0; i < doujin.imageUrls.length; i += batchSize) {
          const imagesToSend = doujin.imageUrls.slice(i, i + batchSize);
          const mediaGroup = imagesToSend.map((url, index) => ({
            type: "photo",
            media: url,
            caption:
              index === 0
                ? `Pages ${i + 1}-${Math.min(i + batchSize, totalPages)}/${totalPages}`
                : undefined,
          }));
          await bot.sendChatAction(chatId, "upload_photo");
          if (mediaGroup.length > 0) {
            try {
              await bot.sendMediaGroup(chatId, mediaGroup);
            } catch (error) {
              console.error(`Failed to send media group: ${error.message}`);
              await bot.sendMessage(chatId, "Failed to send images in batch.");
            }
          }
          await delay(10000);
        }
      } else {
        await bot.sendMessage(chatId, "Failed to download doujin images.");
      }
      await bot.answerCallbackQuery(callbackQuery.id);
    } else {
      await bot.answerCallbackQuery(callbackQuery.id);
    }
  },
  onInline: async ({ bot, inlineQuery }) => {
    const { id, query } = inlineQuery;
    const doujins = await searchDoujin(query);
    const results = doujins.map((doujin) => {
      let flag = "🇯🇵";
      if (doujin.language.toLowerCase() === "english") flag = "🇺🇸";
      else if (doujin.language.toLowerCase() === "chinese") flag = "🇨🇳";
      return {
        type: "article",
        id: doujin.id.toString(),
        title: `${flag} ${doujin.title}`,
        input_message_content: { message_text: `/nhentai ${doujin.id}` },
        thumb_url: `https://t3.nhentai.net/galleries/${doujin.media_id}/thumb.jpg`,
        description: `ID: ${doujin.id} | Language: ${doujin.language}`,
      };
    });
    await bot.answerInlineQuery(id, results);
  },
  onChat: null,
};
