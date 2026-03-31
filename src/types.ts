export type InterviewCategory = 'HR' | 'Technical' | 'Behavioral' | 'Aptitude';

export interface Question {
  id?: string;
  text: string;
  category: InterviewCategory;
  section?: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
}

export interface EvaluationResult {
  score: number;
  sentiment: 'Positive' | 'Neutral' | 'Negative';
  feedback: string;
  keywordsFound: string[];
  suggestions: string[];
}

export interface InterviewSession {
  id?: string;
  userId: string;
  date: string;
  category: InterviewCategory;
  jobRole?: string;
  resumeText?: string;
  questions: string[];
  answers: string[];
  evaluations: EvaluationResult[];
  averageScore: number;
}

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  photoURL?: string;
  createdAt: string;
}
