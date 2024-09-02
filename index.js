import express from "express";
import multer from "multer";
import fs from "fs";
import { pdf } from "pdf-to-img";
import OpenAI from "openai";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const PORT = process.env.PORT || 9000;

// i'll put the API key in env file later.
const API_KEY = process.env.API_KEY;

const openai = new OpenAI({
  apiKey: API_KEY,
});

// Function to convert PDF ot BASE64 URLs
async function convertPdfFileToImageUrls(buffer) {
  const document = await pdf(buffer);

  const pages = [];

  for await (const page of document) {
    const base64Image = Buffer.from(page).toString("base64");
    //below is the json that should be sent to openai
    pages.push({
      type: "image_url",
      image_url: {
        url: `data:image/jpeg;base64,${base64Image}`,
      },
    });
  }

  return pages;
}

// Route to handle PDF uploads
app.post("/upload", upload.single("pdf"), async (req, res) => {
  try {
    const buffer = req.file.buffer;

    // Convert PDF to image URLs first
    const pages = await convertPdfFileToImageUrls(buffer);

    // Array to store the results from OpenAI API, then loop thru the data
    const results = [];

    // Send 3 pages at a time to the OpenAI API (ideally to minimize response time)
    for (let i = 0; i < pages.length; i += 3) {
      const pageGroup = pages.slice(i, i + 3);

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `You will be acting as a teacher who is grading student essays. 
              Thoroughly analyze the attached text pages from the student essay's PDF. 
              Based on this information, I want you to give me these things for each page:
              Claim/ Focus: How strong is the claim and how well does the page maintain it's focus of the topic? 
              Support/ Evidence: How strong is the evidence used to support all the claims and assertions in that page? 
              Organization: How well is the paper structured and how easy is it navigate and read as a human? 
              Images/ Tables/ Graphics: If the page has any images, charts, or tables, how effective is it in supporting the claim and how good does it function as evidence?
              While returning your response, only use plain text. Don't use any form of markdown or styling.`,
              },
              ...pageGroup,
            ],
          },
        ],
      });

      // Extract the response and store it in the results array
      results.push(response.choices[0].message.content);
    }

    // Make a final API call to get an overall score (like omn the cograder website)
    const finalResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: `Here are the individual analyses of groups of pages: ${results.join(
            "\n"
          )}. Based on these analyses, provide an overall summary or score for the entire document following this guideline:
          Glow: Three bullet points at the project does good at
          Grow: Three bullet points at what the project can do better at
          Action Items: Three suggestions to make the original authors reflect how they could've made the project paper better.
          Then I want you to give these information:
          Claim/ Focus (out of 5 points): How strong is the claim and how well does the pdf maintain it's focus of the topic? Give a short summary why it deserved that point.
          Support/ Evidence (out of 5 points): How strong is the evidence used to support all the claims and assertions? Give a short summary why it deserved that point.
          Organization (out of 5 points): How well is the paper structured and how easy is it navigate and read as a human?  Give a short summary why it deserved that point.
          Image/ Text/ Charts (out of 5 points): How well does the paper incorporate images, charts and tables to support the overall claim and how effective does it work as evidence overall? Give a short summary why it deserved that point.
          The attached text from the PDF might also have charts and images. I also want a three sentence summary of the academic paper so I can evaluate the images.

          Give it to me in the following JSON:
          {
            "glow": [],
            "grow": [],
            "action_items": [],
            "claim": { "points": "number", "commentary": "text" },
            "support": { "points": "number", "commentary": "text" },
            "organization": { "points": "number", "commentary": "text" },
            "graphics": { "points": "number", "commentary": "text" },
            "summary": "text"
          }
          I just want the raw JSON and nothing else from you. I don't want three tick marks in the beginning or at the end. I just want the JSON surrounded by curly braces.`,
        },
      ],
    });

    
    res.json(JSON.parse(finalResponse.choices[0].message.content));
  } catch (err) {
    console.error("Error:", err);
    res.status(500).send("An error occurred while processing the PDF.");
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
