import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Brain, CheckCircle2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Question {
  questionText: string;
  correctAnswer: string;
  construct: string;
  difficultyLevel: number;
}

interface Blocker {
  blocker_name: string;
  error_count: number;
}

export default function Diagnostic() {
  const [stage, setStage] = useState<"age" | "student-info" | "main-test" | "confirmatory" | "roadmap">("age");
  const [age, setAge] = useState<number | null>(null);
  const [studentName, setStudentName] = useState("");
  const [studentId, setStudentId] = useState<string | null>(null);
  const [testId, setTestId] = useState<string | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [responses, setResponses] = useState<any[]>([]);
  const [userAnswer, setUserAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const [roadmap, setRoadmap] = useState<any>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  const MAIN_TEST_LENGTH = 10;
  const CONFIRMATORY_LENGTH = 5;

  const handleAgeSubmit = () => {
    if (!age || age < 5) {
      toast({
        variant: "destructive",
        title: "Invalid Age",
        description: "Please enter an age of 5 or above.",
      });
      return;
    }
    setStage("student-info");
  };

  const handleStudentInfoSubmit = async () => {
    if (!studentName.trim()) {
      toast({
        variant: "destructive",
        title: "Missing Name",
        description: "Please enter the student's name.",
      });
      return;
    }

    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({
          variant: "destructive",
          title: "Not Authenticated",
          description: "Please sign in to continue.",
        });
        navigate("/auth");
        return;
      }

      // Create student
      const { data: student, error: studentError } = await supabase
        .from("students")
        .insert({ name: studentName, age: age!, teacher_id: session.user.id })
        .select()
        .single();

      if (studentError) throw studentError;
      setStudentId(student.id);

      // Create diagnostic test
      const { data: test, error: testError } = await supabase
        .from("diagnostic_tests")
        .insert({ student_id: student.id, age_at_test: age!, status: "in_progress" })
        .select()
        .single();

      if (testError) throw testError;
      setTestId(test.id);

      // Generate ALL 10 questions at once to avoid rate limits
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-question`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ age, errorHistory: [], count: 10 }),
        }
      );

      if (response.status === 429) {
        toast({
          variant: "destructive",
          title: "Rate Limit Exceeded",
          description: "Service is busy. Please try again in a moment.",
        });
        setLoading(false);
        return;
      }

      if (!response.ok) throw new Error("Failed to generate questions");

      const questions = await response.json();
      setQuestions(Array.isArray(questions) ? questions : [questions]);
      setStage("main-test");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAnswerSubmit = async () => {
    if (!userAnswer.trim()) {
      toast({
        variant: "destructive",
        title: "Missing Answer",
        description: "Please enter your answer.",
      });
      return;
    }

    const question = questions[currentQuestion];
    const isCorrect = userAnswer.trim().toLowerCase() === question.correctAnswer.toLowerCase();

    const response = {
      questionNumber: currentQuestion + 1,
      questionText: question.questionText,
      userAnswer,
      correctAnswer: question.correctAnswer,
      isCorrect,
      construct: question.construct,
      difficultyLevel: question.difficultyLevel,
    };

    const newResponses = [...responses, response];
    setResponses(newResponses);
    setUserAnswer("");

    // Check if main test is complete
    if (stage === "main-test" && newResponses.length === MAIN_TEST_LENGTH) {
      await saveResponses(newResponses.slice(0, MAIN_TEST_LENGTH));
      await detectBlockers(newResponses);
      return;
    }

    // Check if confirmatory test is complete
    if (stage === "confirmatory" && newResponses.length === MAIN_TEST_LENGTH + CONFIRMATORY_LENGTH) {
      await saveResponses(newResponses.slice(MAIN_TEST_LENGTH));
      await generateRoadmap(newResponses);
      return;
    }

    // Move to next question (all questions already generated)
    setCurrentQuestion(currentQuestion + 1);
  };

  const saveResponses = async (responsesToSave: any[]) => {
    if (!testId) return;

    try {
      const { error } = await supabase
        .from("test_responses")
        .insert(
          responsesToSave.map((r) => ({
            test_id: testId,
            question_number: r.questionNumber,
            question_text: r.questionText,
            user_answer: r.userAnswer,
            correct_answer: r.correctAnswer,
            is_correct: r.isCorrect,
            construct_tested: r.construct,
            difficulty_level: r.difficultyLevel,
          }))
        );

      if (error) throw error;
    } catch (error: any) {
      console.error("Error saving responses:", error);
    }
  };

  const detectBlockers = async (allResponses: any[]) => {
    // Rule-based blocker detection: 2+ errors in same construct
    const constructErrors: Record<string, number> = {};
    allResponses
      .filter((r) => !r.isCorrect)
      .forEach((r) => {
        constructErrors[r.construct] = (constructErrors[r.construct] || 0) + 1;
      });

    const detectedBlockers: Blocker[] = Object.entries(constructErrors)
      .filter(([_, count]) => count >= 2)
      .map(([construct, count]) => ({
        blocker_name: construct,
        error_count: count,
      }));

    if (detectedBlockers.length === 0) {
      // No blockers, skip to roadmap
      await generateRoadmap(allResponses);
      return;
    }

    setBlockers(detectedBlockers);

    // Save blockers to database
    if (testId) {
      try {
        const { error } = await supabase
          .from("blockers_detected")
          .insert(
            detectedBlockers.map((b) => ({
              test_id: testId,
              blocker_name: b.blocker_name,
              error_count: b.error_count,
              is_confirmed: false,
            }))
          );

        if (error) throw error;
      } catch (error: any) {
        console.error("Error saving blockers:", error);
      }
    }
    
    // Generate ALL confirmatory questions at once
    setLoading(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-confirmatory-test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ age, blockerName: detectedBlockers[0].blocker_name }),
        }
      );

      if (response.status === 429) {
        toast({
          variant: "destructive",
          title: "Rate Limit Exceeded",
          description: "Please wait a moment before continuing the confirmatory test.",
        });
        setLoading(false);
        return;
      }

      if (!response.ok) throw new Error("Failed to generate confirmatory test");

      const confirmatoryQuestions = await response.json();
      setQuestions([...questions, ...confirmatoryQuestions]);
      setCurrentQuestion(allResponses.length);
      setStage("confirmatory");
      
      toast({
        title: "Blocker Detected",
        description: `We've identified potential difficulty with ${detectedBlockers[0].blocker_name}. Let's confirm with a few more questions.`,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const generateRoadmap = async (allResponses: any[]) => {
    setLoading(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-roadmap`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ age, blockers, responses: allResponses }),
        }
      );

      if (response.status === 429) {
        toast({
          variant: "destructive",
          title: "Rate Limit Exceeded",
          description: "Please wait before generating the roadmap.",
        });
        setLoading(false);
        return;
      }

      if (!response.ok) throw new Error("Failed to generate roadmap");

      const roadmapData = await response.json();
      setRoadmap(roadmapData);

      // Save roadmap to database
      if (testId) {
        const { error: roadmapError } = await supabase
          .from("remediation_roadmaps")
          .insert({
            test_id: testId,
            roadmap_data: roadmapData,
          });

        if (roadmapError) throw roadmapError;

        // Calculate overall severity
        const errorRate = allResponses.filter(r => !r.isCorrect).length / allResponses.length;
        let severity: "none" | "mild" | "moderate" | "severe" = "none";
        if (blockers.length >= 3 || errorRate > 0.6) severity = "severe";
        else if (blockers.length >= 2 || errorRate > 0.4) severity = "moderate";
        else if (blockers.length >= 1 || errorRate > 0.2) severity = "mild";

        // Mark test as completed
        const { error: testError } = await supabase
          .from("diagnostic_tests")
          .update({ 
            status: "completed", 
            completed_at: new Date().toISOString(),
            overall_severity: severity,
          })
          .eq("id", testId);

        if (testError) throw testError;

        // Confirm blockers
        if (blockers.length > 0) {
          const { error: blockerError } = await supabase
            .from("blockers_detected")
            .update({ is_confirmed: true })
            .eq("test_id", testId);

          if (blockerError) throw blockerError;
        }
      }

      setStage("roadmap");

      toast({
        title: "Assessment Complete!",
        description: "Your personalized roadmap is ready.",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const progress = stage === "main-test" 
    ? (responses.length / MAIN_TEST_LENGTH) * 100
    : stage === "confirmatory"
    ? ((responses.length - MAIN_TEST_LENGTH) / CONFIRMATORY_LENGTH) * 100
    : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-primary/5 to-accent/5 p-4">
      <div className="container max-w-3xl mx-auto py-8">
        <div className="flex items-center justify-center mb-8">
          <Brain className="w-10 h-10 text-primary mr-3" />
          <h1 className="text-3xl font-bold">NeuroMath AI Diagnostic</h1>
        </div>

        {stage === "age" && (
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle>Student Information</CardTitle>
              <CardDescription>Let's start by getting some basic information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="age">Student's Age</Label>
                <Input
                  id="age"
                  type="number"
                  min="5"
                  placeholder="Enter age (5+)"
                  value={age || ""}
                  onChange={(e) => setAge(parseInt(e.target.value))}
                />
              </div>
              <Button onClick={handleAgeSubmit} className="w-full" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Continue
              </Button>
            </CardContent>
          </Card>
        )}

        {stage === "student-info" && (
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle>Student Name</CardTitle>
              <CardDescription>What is the student's name?</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="Enter student's name"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  onKeyPress={(e) => e.key === "Enter" && handleStudentInfoSubmit()}
                  autoFocus
                />
              </div>
              <Button onClick={handleStudentInfoSubmit} className="w-full" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Begin Assessment
              </Button>
            </CardContent>
          </Card>
        )}

        {(stage === "main-test" || stage === "confirmatory") && (
          <div className="space-y-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>
                  {stage === "main-test" ? "Main Test" : "Confirmatory Test"}
                </span>
                <span>
                  Question {stage === "main-test" ? currentQuestion + 1 : currentQuestion - MAIN_TEST_LENGTH + 1} of{" "}
                  {stage === "main-test" ? MAIN_TEST_LENGTH : CONFIRMATORY_LENGTH}
                </span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>

            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle className="text-xl">
                  {questions[currentQuestion]?.questionText}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="answer">Your Answer</Label>
                  <Input
                    id="answer"
                    type="text"
                    placeholder="Type your answer here"
                    value={userAnswer}
                    onChange={(e) => setUserAnswer(e.target.value)}
                    onKeyPress={(e) => e.key === "Enter" && handleAnswerSubmit()}
                    autoFocus
                  />
                </div>
                <Button onClick={handleAnswerSubmit} className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Submit Answer
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {stage === "roadmap" && roadmap && (
          <div className="space-y-6">
            <Card className="shadow-lg border-success">
              <CardHeader className="bg-success/10">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-8 h-8 text-success" />
                  <div>
                    <CardTitle>Assessment Complete!</CardTitle>
                    <CardDescription>Here's your personalized remediation roadmap</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6 pt-6">
                <div>
                  <h3 className="font-semibold text-lg mb-2">Overall Severity: {roadmap.overallSeverity}</h3>
                  <p className="text-muted-foreground">{roadmap.summary}</p>
                </div>

                <div className="space-y-4">
                  <h3 className="font-bold text-xl">5-Step Action Roadmap</h3>
                  {roadmap.steps.map((step: any) => (
                    <Card key={step.stepNumber} className="border-l-4 border-l-primary">
                      <CardHeader>
                        <CardTitle className="text-lg">
                          Step {step.stepNumber}: {step.title}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div>
                          <p className="font-semibold text-sm text-muted-foreground mb-1">Execution Plan:</p>
                          <p className="text-sm">{step.executionPlan}</p>
                        </div>
                        <div>
                          <p className="font-semibold text-sm text-muted-foreground mb-1">Resources:</p>
                          <ul className="list-disc list-inside space-y-1">
                            {step.resources.map((resource: string, idx: number) => (
                              <li key={idx} className="text-sm">{resource}</li>
                            ))}
                          </ul>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <div className="flex gap-4">
                  <Button onClick={() => window.print()} variant="outline" className="flex-1">
                    Print Roadmap
                  </Button>
                  <Button onClick={() => navigate("/")} className="flex-1">
                    Return Home
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
