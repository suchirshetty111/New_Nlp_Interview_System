import { GoogleGenAI, Type } from "@google/genai";
import { EvaluationResult } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export const evaluateAnswer = async (
  question: string, 
  answer: string,
  jobRole?: string,
  resumeText?: string
): Promise<EvaluationResult> => {
  const model = "gemini-3-flash-preview";
  
  const prompt = `
    Evaluate the following interview answer.
    
    Context:
    ${jobRole ? `- Target Job Role: ${jobRole}` : ""}
    ${resumeText ? `- Candidate's Resume Content: ${resumeText}` : ""}
    
    Interview Details:
    Question: "${question}"
    User Answer: "${answer}"
    
    Instructions:
    1. Provide a score (0-10) based on clarity, relevance, and professionalism.
    2. If a resume/job role is provided, judge how well the answer aligns with the candidate's background and the role's requirements.
    3. Identify sentiment (Positive, Neutral, Negative).
    4. Provide constructive feedback.
    5. List keywords found in the answer.
    6. Provide specific suggestions for improvement.
    
    Return the evaluation as a JSON object.
  `;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          score: { type: Type.NUMBER },
          sentiment: { type: Type.STRING },
          feedback: { type: Type.STRING },
          keywordsFound: { type: Type.ARRAY, items: { type: Type.STRING } },
          suggestions: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["score", "sentiment", "feedback", "keywordsFound", "suggestions"]
      }
    }
  });

  try {
    const result = JSON.parse(response.text || "{}");
    return {
      score: result.score || 0,
      sentiment: (result.sentiment as any) || "Neutral",
      feedback: result.feedback || "No feedback provided.",
      keywordsFound: result.keywordsFound || [],
      suggestions: result.suggestions || []
    };
  } catch (error) {
    console.error("Failed to parse Gemini response:", error);
    return {
      score: 0,
      sentiment: "Neutral",
      feedback: "Error evaluating answer.",
      keywordsFound: [],
      suggestions: []
    };
  }
};

export const suggestBetterPhrasing = async (answer: string): Promise<string> => {
  const model = "gemini-3-flash-preview";
  const prompt = `Suggest a more professional and impactful way to say this interview answer: "${answer}"`;
  
  const response = await ai.models.generateContent({
    model,
    contents: prompt
  });
  
  return response.text || answer;
};

export const generateQuestions = async (
  category: string, 
  count: number, 
  jobRole?: string, 
  resumeText?: string
): Promise<string[]> => {
  const model = "gemini-3-flash-preview";
  
  const prompt = `
    You are an expert interviewer. Generate ${count} high-quality interview questions for a ${category} interview.
    
    Context:
    ${jobRole ? `- Target Job Role: ${jobRole}` : ""}
    ${resumeText ? `- Candidate's Resume Content: ${resumeText}` : ""}
    
    Instructions:
    1. If a resume is provided:
       - Parse it for key technical/soft skills, specific past projects, and quantifiable achievements (e.g., "increased revenue by 20%", "managed a team of 10").
       - Generate at least 50-60% of the questions based directly on these resume details. 
       - Ask deep-dive questions about their role in specific projects mentioned.
       - Ask how they applied their listed skills to solve real-world problems.
       - Specifically for HR rounds, ask how their background and skills align with the target job role's culture and requirements.
    2. If a job role is provided:
       - Ensure questions are relevant to the seniority and technical requirements of that role.
       - Ask how their past experiences prepare them for the challenges of this specific role.
    3. General Category Questions:
       - The remaining questions should be standard but challenging ${category} questions.
       - For HR: focus on cultural fit, conflict resolution, career aspirations, and work ethic.
    4. Diversity:
       - Ensure a mix of situational, technical (if applicable), and behavioral questions.
    
    Return the questions as a JSON array of strings.
  `;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: { type: Type.STRING }
      }
    }
  });

  try {
    return JSON.parse(response.text || "[]");
  } catch (error) {
    console.error("Failed to parse generated questions:", error);
    return [];
  }
};
