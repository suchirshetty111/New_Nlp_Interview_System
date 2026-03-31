import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
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
  section: string,
  jobRole?: string, 
  resumeText?: string
): Promise<string[]> => {
  const model = "gemini-3-flash-preview";
  
  const prompt = `
    You are an expert interviewer. Your task is to generate ${count} high-quality interview questions specifically for the "${section}" stage of a ${category} interview.
    
    Context:
    ${jobRole ? `- Target Job Role: ${jobRole}` : ""}
    ${resumeText ? `- Candidate's Resume Content: ${resumeText}` : ""}
    
    Interview Stage: ${section}
    
    Instructions for this specific stage:
    1. Introduction Stage:
       - Focus on breaking the ice, understanding the candidate's journey, and their motivation for the role.
       - Ask about their "elevator pitch" and how their background led them here.
    2. Core Skills Stage:
       - Dive deep into technical or functional competencies required for the ${jobRole || category} role.
       - If a resume is provided, ask about specific technologies, methodologies, or projects listed.
       - Focus on "how" and "why" they made certain decisions in their work.
    3. Behavioral Stage:
       - Use the STAR method (Situation, Task, Action, Result) to frame questions.
       - Focus on soft skills: leadership, conflict resolution, adaptability, and teamwork.
       - Ask for specific examples from their past experience.
    4. Closing Stage:
       - Focus on long-term career alignment, cultural fit, and their interest in this specific company/role.
       - Ask what they are looking for in their next challenge.
    
    General Guidelines:
    - Ensure questions are challenging but fair.
    - If a resume is provided, tailor at least 60% of the questions to the candidate's specific experience.
    - Return the questions as a JSON array of strings.
  `;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
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

export const generateOverallSummary = async (
  category: string,
  evaluations: EvaluationResult[],
  questions: string[],
  answers: string[]
): Promise<{ summary: string; strengths: string[]; improvements: string[] }> => {
  const model = "gemini-3-flash-preview";
  
  const interviewData = questions.map((q, i) => ({
    question: q,
    answer: answers[i],
    score: evaluations[i].score,
    feedback: evaluations[i].feedback,
    suggestions: evaluations[i].suggestions
  }));

  const prompt = `
    Based on the following interview session results for a ${category} round, provide a comprehensive summary of the candidate's performance.
    
    Interview Data:
    ${JSON.stringify(interviewData, null, 2)}
    
    Instructions:
    1. Provide a concise overall summary of the performance (2-3 sentences).
    2. Highlight 3-4 key strengths observed across all answers.
    3. Identify 3-4 specific areas for improvement.
    
    Return the response as a JSON object.
  `;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
          improvements: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["summary", "strengths", "improvements"]
      }
    }
  });

  try {
    return JSON.parse(response.text || "{}");
  } catch (error) {
    console.error("Failed to parse overall summary:", error);
    return {
      summary: "Could not generate summary.",
      strengths: [],
      improvements: []
    };
  }
};
