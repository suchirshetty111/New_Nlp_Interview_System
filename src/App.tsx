import React, { useState, useEffect } from 'react';
import { 
  collection, 
  addDoc, 
  getDocs, 
  query, 
  where, 
  limit, 
  orderBy, 
  onSnapshot,
  Timestamp,
  doc,
  setDoc,
  getDoc
} from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, db, signInWithGoogle, logout } from './firebase';
import { Question, InterviewCategory, InterviewSession, EvaluationResult, UserProfile } from './types';
import { evaluateAnswer, suggestBetterPhrasing, generateQuestions } from './services/gemini';
import { VoiceInput } from './components/VoiceInput';
import { 
  Mic, 
  Send, 
  CheckCircle2, 
  AlertCircle, 
  History, 
  LayoutDashboard, 
  LogOut, 
  ChevronRight, 
  Download,
  BrainCircuit,
  Award,
  BarChart3,
  User as UserIcon,
  PlusCircle,
  FileText,
  Upload,
  Briefcase
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { jsPDF } from 'jspdf';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const CATEGORIES: InterviewCategory[] = ['HR', 'Technical', 'Behavioral', 'Aptitude'];

const SEED_QUESTIONS: Omit<Question, 'id'>[] = [
  { text: "Tell me about yourself.", category: "HR", difficulty: "Easy" },
  { text: "What are your strengths and weaknesses?", category: "HR", difficulty: "Easy" },
  { text: "Why do you want to work for this company?", category: "HR", difficulty: "Medium" },
  { text: "Where do you see yourself in 5 years?", category: "HR", difficulty: "Medium" },
  { text: "Explain the concept of Object-Oriented Programming.", category: "Technical", difficulty: "Medium" },
  { text: "What is the difference between SQL and NoSQL databases?", category: "Technical", difficulty: "Hard" },
  { text: "Describe a time you faced a difficult challenge at work and how you overcame it.", category: "Behavioral", difficulty: "Hard" },
  { text: "How do you handle conflict within a team?", category: "Behavioral", difficulty: "Medium" },
  { text: "If you have 5 machines that take 5 minutes to make 5 widgets, how long would it take 100 machines to make 100 widgets?", category: "Aptitude", difficulty: "Medium" },
];

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // We don't throw here to avoid crashing the whole app, but we log it clearly
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<'landing' | 'category' | 'setup' | 'interview' | 'results' | 'history' | 'dashboard'>('landing');
  const [selectedCategory, setSelectedCategory] = useState<InterviewCategory | null>(null);
  const [jobRole, setJobRole] = useState('');
  const [resumeText, setResumeText] = useState('');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [evaluations, setEvaluations] = useState<EvaluationResult[]>([]);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [history, setHistory] = useState<InterviewSession[]>([]);
  const [loading, setLoading] = useState(true);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u) {
        syncUserProfile(u);
        fetchHistory(u.uid);
        testConnection(u.uid);
      }
    });
    return unsubscribe;
  }, []);

  const testConnection = async (uid: string) => {
    try {
      const { getDocFromServer } = await import('firebase/firestore');
      await getDocFromServer(doc(db, 'users', uid));
    } catch (error) {
      if (error instanceof Error && error.message.includes('the client is offline')) {
        console.error("Firestore connection test failed: client is offline.");
      }
    }
  };

  const syncUserProfile = async (u: User) => {
    try {
      const userRef = doc(db, 'users', u.uid);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        await setDoc(userRef, {
          uid: u.uid,
          name: u.displayName || 'User',
          email: u.email || '',
          photoURL: u.photoURL || '',
          createdAt: new Date().toISOString()
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${u.uid}`);
    }
  };

  const fetchHistory = (uid: string) => {
    try {
      const q = query(collection(db, 'results'), where('userId', '==', uid));
      return onSnapshot(q, (snapshot) => {
        const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as InterviewSession));
        // Sort manually in memory for now
        const sortedDocs = docs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        setHistory(sortedDocs);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'results');
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'results');
    }
  };

  const seedQuestions = async () => {
    try {
      const qSnap = await getDocs(collection(db, 'questions'));
      if (qSnap.empty) {
        // Only try to seed if user is admin (email check)
        if (user?.email === "shettysuchir@gmail.com") {
          for (const q of SEED_QUESTIONS) {
            await addDoc(collection(db, 'questions'), q);
          }
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'questions');
    }
  };

  const startInterviewSetup = (category: InterviewCategory) => {
    setSelectedCategory(category);
    setView('setup');
  };

  const handleResumeUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setResumeText(event.target?.result as string);
      };
      reader.readAsText(file);
    }
  };

  const startInterview = async () => {
    if (!selectedCategory) return;
    
    setLoading(true);
    const count = selectedCategory === 'Aptitude' ? 15 : 8;
    
    const generatedQs = await generateQuestions(selectedCategory, count, jobRole, resumeText);
    
    const formattedQs: Question[] = generatedQs.map(text => ({
      text,
      category: selectedCategory,
      difficulty: 'Medium'
    }));

    setQuestions(formattedQs);
    setAnswers([]);
    setEvaluations([]);
    setCurrentQuestionIndex(0);
    setCurrentAnswer('');
    setView('interview');
    setLoading(false);
  };

  const handleNextQuestion = async () => {
    if (!currentAnswer.trim()) return;

    setIsEvaluating(true);
    const evaluation = await evaluateAnswer(
      questions[currentQuestionIndex].text, 
      currentAnswer,
      jobRole,
      resumeText
    );
    
    const newAnswers = [...answers, currentAnswer];
    const newEvaluations = [...evaluations, evaluation];
    
    setAnswers(newAnswers);
    setEvaluations(newEvaluations);
    setCurrentAnswer('');
    setIsEvaluating(false);

    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
    } else {
      // Finish Interview
      saveResults(newAnswers, newEvaluations);
      setView('results');
    }
  };

  const saveResults = async (finalAnswers: string[], finalEvaluations: EvaluationResult[]) => {
    if (!user || !selectedCategory) return;

    const avgScore = finalEvaluations.reduce((acc, curr) => acc + curr.score, 0) / finalEvaluations.length;

    const session: Omit<InterviewSession, 'id'> = {
      userId: user.uid,
      date: new Date().toISOString(),
      category: selectedCategory,
      jobRole,
      resumeText,
      questions: questions.map(q => q.text),
      answers: finalAnswers,
      evaluations: finalEvaluations,
      averageScore: avgScore
    };

    await addDoc(collection(db, 'results'), session);
  };

  const generatePDF = (session: InterviewSession) => {
    const doc = new jsPDF();
    const margin = 20;
    let y = 20;

    doc.setFontSize(22);
    doc.text("Interview Performance Report", margin, y);
    y += 10;
    
    doc.setFontSize(12);
    doc.text(`Category: ${session.category}`, margin, y);
    y += 7;
    doc.text(`Date: ${new Date(session.date).toLocaleDateString()}`, margin, y);
    y += 7;
    doc.text(`Average Score: ${session.averageScore.toFixed(1)}/10`, margin, y);
    y += 15;

    session.questions.forEach((q, i) => {
      if (y > 250) { doc.addPage(); y = 20; }
      
      doc.setFont("helvetica", "bold");
      doc.text(`Q${i+1}: ${q}`, margin, y);
      y += 7;
      
      doc.setFont("helvetica", "normal");
      const splitAnswer = doc.splitTextToSize(`A: ${session.answers[i]}`, 170);
      doc.text(splitAnswer, margin, y);
      y += splitAnswer.length * 5 + 5;

      const evalData = session.evaluations[i];
      doc.text(`Score: ${evalData.score}/10 | Sentiment: ${evalData.sentiment}`, margin, y);
      y += 7;
      
      const splitFeedback = doc.splitTextToSize(`Feedback: ${evalData.feedback}`, 170);
      doc.text(splitFeedback, margin, y);
      y += splitFeedback.length * 5 + 10;
    });

    doc.save(`Interview_Report_${session.category}_${new Date().getTime()}.pdf`);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
        >
          <BrainCircuit className="text-indigo-600" size={48} />
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Navigation */}
      <nav className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-50">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => setView('landing')}>
          <BrainCircuit className="text-indigo-600" size={32} />
          <h1 className="text-xl font-bold tracking-tight">SmartInterview</h1>
        </div>
        
        {user ? (
          <div className="flex items-center gap-4">
            <button onClick={() => setView('dashboard')} className="text-sm font-medium text-slate-600 hover:text-indigo-600 flex items-center gap-1">
              <LayoutDashboard size={18} /> Dashboard
            </button>
            <button onClick={() => setView('history')} className="text-sm font-medium text-slate-600 hover:text-indigo-600 flex items-center gap-1">
              <History size={18} /> History
            </button>
            <div className="h-8 w-px bg-slate-200 mx-2" />
            <div className="flex items-center gap-3">
              <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full border border-slate-200" />
              <button onClick={logout} className="text-slate-400 hover:text-red-500 transition-colors">
                <LogOut size={20} />
              </button>
            </div>
          </div>
        ) : (
          <button 
            onClick={signInWithGoogle}
            className="bg-indigo-600 text-white px-5 py-2 rounded-full font-medium hover:bg-indigo-700 transition-all shadow-sm"
          >
            Sign In
          </button>
        )}
      </nav>

      <main className="max-w-5xl mx-auto p-6">
        <AnimatePresence mode="wait">
          {/* Landing View */}
          {view === 'landing' && (
            <motion.div 
              key="landing"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="text-center py-20"
            >
              <h2 className="text-5xl font-extrabold text-slate-900 mb-6 leading-tight">
                Master Your Next Interview <br />
                <span className="text-indigo-600">Powered by AI & NLP</span>
              </h2>
              <p className="text-xl text-slate-600 mb-10 max-w-2xl mx-auto">
                Practice with real-world questions, get instant feedback, and track your progress with our intelligent interview bot.
              </p>
              
              {!user ? (
                <button 
                  onClick={signInWithGoogle}
                  className="bg-indigo-600 text-white px-8 py-4 rounded-2xl text-lg font-bold hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-200 flex items-center gap-3 mx-auto"
                >
                  Get Started Free <ChevronRight size={24} />
                </button>
              ) : (
                <button 
                  onClick={() => setView('category')}
                  className="bg-indigo-600 text-white px-8 py-4 rounded-2xl text-lg font-bold hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-200 flex items-center gap-3 mx-auto"
                >
                  Start New Session <PlusCircle size={24} />
                </button>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-24">
                {[
                  { icon: <Mic className="text-emerald-500" />, title: "Voice Analysis", desc: "Practice speaking naturally with our integrated speech-to-text technology." },
                  { icon: <BrainCircuit className="text-indigo-500" />, title: "NLP Evaluation", desc: "Advanced analysis of your answers for relevance, sentiment, and clarity." },
                  { icon: <BarChart3 className="text-amber-500" />, title: "Detailed Reports", desc: "Download comprehensive PDF reports with scores and improvement tips." }
                ].map((feature, i) => (
                  <div key={i} className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow text-left">
                    <div className="mb-4 bg-slate-50 w-12 h-12 rounded-2xl flex items-center justify-center">
                      {feature.icon}
                    </div>
                    <h3 className="text-xl font-bold mb-2">{feature.title}</h3>
                    <p className="text-slate-500 leading-relaxed">{feature.desc}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Category Selection */}
          {view === 'category' && (
            <motion.div 
              key="category"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="py-12"
            >
              <h2 className="text-3xl font-bold mb-8 text-center">Choose Your Interview Type</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => startInterviewSetup(cat)}
                    className="group bg-white p-8 rounded-3xl border-2 border-transparent hover:border-indigo-600 transition-all text-left shadow-sm hover:shadow-xl"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                        {cat === 'HR' && <UserIcon size={24} />}
                        {cat === 'Technical' && <BrainCircuit size={24} />}
                        {cat === 'Behavioral' && <Award size={24} />}
                        {cat === 'Aptitude' && <BarChart3 size={24} />}
                      </div>
                      <ChevronRight className="text-slate-300 group-hover:text-indigo-600 transition-colors" />
                    </div>
                    <h3 className="text-2xl font-bold mb-2">{cat} Interview</h3>
                    <p className="text-slate-500">
                      {cat === 'HR' && "General fit, personality, and career goals."}
                      {cat === 'Technical' && "Core concepts, problem solving, and skills."}
                      {cat === 'Behavioral' && "Past experiences and situational responses."}
                      {cat === 'Aptitude' && "Logical reasoning and analytical thinking."}
                    </p>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* Interview Setup */}
          {view === 'setup' && (
            <motion.div 
              key="setup"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-2xl mx-auto py-12"
            >
              <div className="bg-white rounded-3xl p-10 shadow-xl border border-slate-100">
                <h2 className="text-3xl font-bold mb-2">Interview Setup</h2>
                <p className="text-slate-500 mb-8">Tell us a bit about yourself to customize your {selectedCategory} interview.</p>
                
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                      <Briefcase size={18} className="text-indigo-600" /> Target Job Role
                    </label>
                    <input 
                      type="text" 
                      value={jobRole}
                      onChange={(e) => setJobRole(e.target.value)}
                      placeholder="e.g. Senior Frontend Developer, HR Manager..."
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                      <FileText size={18} className="text-indigo-600" /> Upload Resume (Optional)
                    </label>
                    <div className="relative">
                      <input 
                        type="file" 
                        accept=".txt,.pdf,.doc,.docx"
                        onChange={handleResumeUpload}
                        className="hidden" 
                        id="resume-upload"
                      />
                      <label 
                        htmlFor="resume-upload"
                        className="flex items-center justify-center gap-3 w-full px-4 py-8 border-2 border-dashed border-slate-200 rounded-2xl cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-all"
                      >
                        <Upload size={24} className="text-slate-400" />
                        <span className="text-slate-600 font-medium">
                          {resumeText ? "Resume Uploaded Successfully" : "Click to upload resume (Text files preferred)"}
                        </span>
                      </label>
                    </div>
                    <p className="text-xs text-slate-400 mt-2 italic">Note: We'll use your resume to ask personalized questions about your experience.</p>
                  </div>

                  <button 
                    onClick={startInterview}
                    className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold text-lg hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 flex items-center justify-center gap-2"
                  >
                    Start {selectedCategory === 'Aptitude' ? '15' : '8'} Question Round <ChevronRight size={20} />
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Interview View */}
          {view === 'interview' && questions.length > 0 && (
            <motion.div 
              key="interview"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="max-w-3xl mx-auto py-12"
            >
              <div className="mb-8 flex justify-between items-end">
                <div>
                  <span className="text-sm font-bold text-indigo-600 uppercase tracking-widest">Question {currentQuestionIndex + 1} of {questions.length}</span>
                  <h2 className="text-3xl font-bold mt-2">{questions[currentQuestionIndex].text}</h2>
                </div>
                <div className="bg-white px-4 py-2 rounded-full border border-slate-200 text-sm font-medium text-slate-500">
                  {selectedCategory}
                </div>
              </div>

              <div className="bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden">
                <textarea
                  value={currentAnswer}
                  onChange={(e) => setCurrentAnswer(e.target.value)}
                  placeholder="Type your answer here or use voice input..."
                  className="w-full h-64 p-8 text-lg focus:outline-none resize-none placeholder:text-slate-300"
                />
                
                <div className="bg-slate-50 p-6 flex justify-between items-center border-t border-slate-100">
                  <div className="flex items-center gap-4">
                    <VoiceInput 
                      onTranscript={(text) => setCurrentAnswer(prev => prev + ' ' + text)}
                      isListening={isListening}
                      setIsListening={setIsListening}
                    />
                    <span className="text-sm text-slate-400">
                      {isListening ? "Listening..." : "Click mic to speak"}
                    </span>
                  </div>
                  
                  <button
                    disabled={!currentAnswer.trim() || isEvaluating}
                    onClick={handleNextQuestion}
                    className={cn(
                      "px-8 py-3 rounded-2xl font-bold flex items-center gap-2 transition-all",
                      currentAnswer.trim() && !isEvaluating 
                        ? "bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-100" 
                        : "bg-slate-200 text-slate-400 cursor-not-allowed"
                    )}
                  >
                    {isEvaluating ? (
                      <>Evaluating <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }}><BrainCircuit size={18} /></motion.div></>
                    ) : (
                      <>Next Question <ChevronRight size={18} /></>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Results View */}
          {view === 'results' && evaluations.length > 0 && (
            <motion.div 
              key="results"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="py-12"
            >
              <div className="bg-white rounded-3xl p-10 shadow-xl border border-slate-100 mb-8 text-center">
                <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-indigo-50 text-indigo-600 mb-6">
                  <Award size={48} />
                </div>
                <h2 className="text-4xl font-extrabold mb-2">Interview Complete!</h2>
                <p className="text-slate-500 text-lg mb-8">You've successfully completed the {selectedCategory} round.</p>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-3xl mx-auto">
                  <div className="bg-slate-50 p-6 rounded-2xl">
                    <span className="text-sm font-bold text-slate-400 uppercase">Average Score</span>
                    <p className="text-3xl font-black text-indigo-600 mt-1">
                      {(evaluations.reduce((a, b) => a + b.score, 0) / evaluations.length).toFixed(1)}/10
                    </p>
                  </div>
                  <div className="bg-slate-50 p-6 rounded-2xl">
                    <span className="text-sm font-bold text-slate-400 uppercase">Questions</span>
                    <p className="text-3xl font-black text-slate-700 mt-1">{questions.length}</p>
                  </div>
                  <div className="bg-slate-50 p-6 rounded-2xl">
                    <span className="text-sm font-bold text-slate-400 uppercase">Sentiment</span>
                    <p className="text-3xl font-black text-emerald-500 mt-1">Positive</p>
                  </div>
                </div>

                <div className="mt-10 flex flex-wrap justify-center gap-4">
                  <button 
                    onClick={() => generatePDF({
                      userId: user?.uid || '',
                      date: new Date().toISOString(),
                      category: selectedCategory!,
                      questions: questions.map(q => q.text),
                      answers,
                      evaluations,
                      averageScore: evaluations.reduce((a, b) => a + b.score, 0) / evaluations.length
                    })}
                    className="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-bold hover:bg-indigo-700 transition-all flex items-center gap-2"
                  >
                    <Download size={20} /> Download PDF Report
                  </button>
                  <button 
                    onClick={() => setView('category')}
                    className="bg-white border-2 border-slate-200 text-slate-600 px-8 py-4 rounded-2xl font-bold hover:border-indigo-600 hover:text-indigo-600 transition-all"
                  >
                    Try Another Round
                  </button>
                </div>
              </div>

              <div className="space-y-6">
                {questions.map((q, i) => (
                  <div key={i} className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm">
                    <div className="flex justify-between items-start mb-4">
                      <h3 className="text-xl font-bold text-slate-800">Q: {q.text}</h3>
                      <span className={cn(
                        "px-3 py-1 rounded-full text-xs font-bold uppercase",
                        evaluations[i].score >= 7 ? "bg-emerald-100 text-emerald-600" : "bg-amber-100 text-amber-600"
                      )}>
                        Score: {evaluations[i].score}/10
                      </span>
                    </div>
                    <p className="text-slate-600 mb-6 italic">" {answers[i]} "</p>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-slate-50">
                      <div>
                        <h4 className="text-sm font-bold text-slate-400 uppercase mb-3 flex items-center gap-2">
                          <CheckCircle2 size={16} className="text-emerald-500" /> Feedback
                        </h4>
                        <p className="text-slate-600 leading-relaxed">{evaluations[i].feedback}</p>
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-400 uppercase mb-3 flex items-center gap-2">
                          <AlertCircle size={16} className="text-amber-500" /> Suggestions
                        </h4>
                        <ul className="space-y-2">
                          {evaluations[i].suggestions.map((s, si) => (
                            <li key={si} className="text-slate-600 flex items-start gap-2">
                              <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-2 shrink-0" />
                              {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* History View */}
          {view === 'history' && (
            <motion.div 
              key="history"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="py-12"
            >
              <h2 className="text-3xl font-bold mb-8">Interview History</h2>
              {history.length === 0 ? (
                <div className="bg-white rounded-3xl p-12 text-center border border-slate-100">
                  <History size={48} className="text-slate-200 mx-auto mb-4" />
                  <p className="text-slate-500">No interview sessions found. Start your first practice!</p>
                  <button onClick={() => setView('category')} className="mt-6 text-indigo-600 font-bold hover:underline">
                    Start Interview
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {history.map((session) => (
                    <div key={session.id} className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex justify-between items-center">
                      <div>
                        <div className="flex items-center gap-3 mb-1">
                          <span className="font-bold text-lg">{session.category} Interview</span>
                          <span className="text-xs font-bold px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full">
                            {new Date(session.date).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="text-slate-500 text-sm">
                          {session.questions.length} Questions • Average Score: {session.averageScore.toFixed(1)}/10
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => generatePDF(session)}
                          className="p-3 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
                          title="Download Report"
                        >
                          <Download size={20} />
                        </button>
                        <button 
                          onClick={() => {
                            setQuestions(session.questions.map(q => ({ text: q, category: session.category, difficulty: 'Medium' })));
                            setAnswers(session.answers);
                            setEvaluations(session.evaluations);
                            setSelectedCategory(session.category);
                            setView('results');
                          }}
                          className="p-3 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
                          title="View Details"
                        >
                          <ChevronRight size={20} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* Dashboard View */}
          {view === 'dashboard' && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="py-12"
            >
              <h2 className="text-3xl font-bold mb-8">Performance Dashboard</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
                <div className="bg-indigo-600 text-white p-8 rounded-3xl shadow-xl shadow-indigo-100">
                  <BarChart3 size={32} className="mb-4 opacity-80" />
                  <span className="text-indigo-100 font-bold uppercase text-xs tracking-widest">Overall Average</span>
                  <p className="text-4xl font-black mt-1">
                    {history.length > 0 
                      ? (history.reduce((a, b) => a + b.averageScore, 0) / history.length).toFixed(1) 
                      : '0.0'}
                  </p>
                </div>
                <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
                  <History size={32} className="mb-4 text-emerald-500" />
                  <span className="text-slate-400 font-bold uppercase text-xs tracking-widest">Total Sessions</span>
                  <p className="text-4xl font-black text-slate-800 mt-1">{history.length}</p>
                </div>
                <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
                  <Award size={32} className="mb-4 text-amber-500" />
                  <span className="text-slate-400 font-bold uppercase text-xs tracking-widest">Best Category</span>
                  <p className="text-4xl font-black text-slate-800 mt-1">
                    {history.length > 0 ? history[0].category : 'N/A'}
                  </p>
                </div>
              </div>

              <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm">
                <h3 className="text-xl font-bold mb-6">Recent Activity</h3>
                <div className="space-y-4">
                  {history.slice(0, 5).map((session, i) => (
                    <div key={i} className="flex items-center gap-4 p-4 hover:bg-slate-50 rounded-2xl transition-colors">
                      <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                        <CheckCircle2 size={24} />
                      </div>
                      <div className="flex-1">
                        <p className="font-bold">{session.category} Interview Round</p>
                        <p className="text-sm text-slate-400">{new Date(session.date).toLocaleDateString()} • {session.averageScore.toFixed(1)}/10</p>
                      </div>
                      <div className="text-right">
                        <span className={cn(
                          "text-sm font-bold px-3 py-1 rounded-full",
                          session.averageScore >= 7 ? "bg-emerald-100 text-emerald-600" : "bg-amber-100 text-amber-600"
                        )}>
                          {session.averageScore >= 7 ? "Great Job" : "Keep Practicing"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-100 py-12 mt-20">
        <div className="max-w-5xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <BrainCircuit className="text-indigo-600" size={24} />
            <span className="font-bold text-slate-900">SmartInterview Bot</span>
          </div>
          <p className="text-slate-400 text-sm">© 2026 SmartInterview. Powered by Google Gemini AI.</p>
          <div className="flex gap-6">
            <a href="#" className="text-slate-400 hover:text-indigo-600 transition-colors text-sm font-medium">Privacy</a>
            <a href="#" className="text-slate-400 hover:text-indigo-600 transition-colors text-sm font-medium">Terms</a>
            <a href="#" className="text-slate-400 hover:text-indigo-600 transition-colors text-sm font-medium">Support</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
