import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Brain, LogOut, Plus, User } from "lucide-react";
import type { Session } from "@supabase/supabase-js";

interface Student {
  id: string;
  name: string;
  age: number;
  created_at: string;
}

interface Blocker {
  id: string;
  blocker_name: string;
  error_count: number;
  is_confirmed: boolean | null;
}

interface RoadmapStep {
  step: number;
  title: string;
  description: string;
  activities: string[];
  duration: string;
}

interface Roadmap {
  roadmap_data: {
    steps: RoadmapStep[];
  };
}

interface DiagnosticTest {
  id: string;
  student_id: string;
  status: string;
  overall_severity: string | null;
  completed_at: string | null;
  created_at: string;
  blockers: Blocker[];
  roadmap: Roadmap | null;
}

interface StudentWithTests extends Student {
  tests: DiagnosticTest[];
}

export default function Dashboard() {
  const [session, setSession] = useState<Session | null>(null);
  const [studentsWithTests, setStudentsWithTests] = useState<StudentWithTests[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        navigate("/auth");
        return;
      }
      setSession(session);
      loadStudents(session.user.id);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        navigate("/auth");
      } else {
        setSession(session);
        loadStudents(session.user.id);
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const loadStudents = async (userId: string) => {
    try {
      setLoading(true);
      
      // Fetch students
      const { data: students, error: studentsError } = await supabase
        .from("students")
        .select("*")
        .eq("teacher_id", userId)
        .order("created_at", { ascending: false });

      if (studentsError) throw studentsError;

      if (!students || students.length === 0) {
        setStudentsWithTests([]);
        return;
      }

      // Fetch all diagnostic tests for these students
      const studentIds = students.map(s => s.id);
      const { data: tests, error: testsError } = await supabase
        .from("diagnostic_tests")
        .select("*")
        .in("student_id", studentIds)
        .order("created_at", { ascending: false });

      if (testsError) throw testsError;

      // Fetch blockers for all tests
      const testIds = tests?.map(t => t.id) || [];
      const { data: blockers, error: blockersError } = await supabase
        .from("blockers_detected")
        .select("*")
        .in("test_id", testIds);

      if (blockersError) throw blockersError;

      // Fetch roadmaps with full data
      const { data: roadmaps, error: roadmapsError } = await supabase
        .from("remediation_roadmaps")
        .select("test_id, roadmap_data")
        .in("test_id", testIds);

      if (roadmapsError) throw roadmapsError;

      const roadmapsByTest = (roadmaps || []).reduce((acc, roadmap) => {
        acc[roadmap.test_id] = { roadmap_data: roadmap.roadmap_data as unknown as { steps: RoadmapStep[] } };
        return acc;
      }, {} as Record<string, Roadmap>);

      // Group blockers by test_id
      const blockersByTest = (blockers || []).reduce((acc, blocker) => {
        if (!acc[blocker.test_id]) acc[blocker.test_id] = [];
        acc[blocker.test_id].push(blocker);
        return acc;
      }, {} as Record<string, Blocker[]>);

      // Group tests by student_id with blockers and roadmaps
      const testsByStudent = (tests || []).reduce((acc, test) => {
        if (!acc[test.student_id]) acc[test.student_id] = [];
        acc[test.student_id].push({
          ...test,
          blockers: blockersByTest[test.id] || [],
          roadmap: roadmapsByTest[test.id] || null,
        });
        return acc;
      }, {} as Record<string, DiagnosticTest[]>);

      // Combine students with their tests
      const studentsWithTestsData: StudentWithTests[] = students.map(student => ({
        ...student,
        tests: testsByStudent[student.id] || [],
      }));

      setStudentsWithTests(studentsWithTestsData);
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

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  if (!session) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-primary/5 to-accent/5">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/30 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Brain className="w-8 h-8 text-primary" />
              <h1 className="text-2xl font-bold">NeuroMath AI Dashboard</h1>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <User className="w-4 h-4" />
                {session.user.email}
              </div>
              <Button variant="outline" size="sm" onClick={handleSignOut}>
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-3xl font-bold mb-2">My Students</h2>
              <p className="text-muted-foreground">
                Track diagnostic assessments and remediation progress
              </p>
            </div>
            <Button onClick={() => navigate("/diagnostic")}>
              <Plus className="w-4 h-4 mr-2" />
              New Assessment
            </Button>
          </div>
        </div>

        {loading ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">Loading students...</p>
            </CardContent>
          </Card>
        ) : studentsWithTests.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center space-y-4">
              <Brain className="w-16 h-16 text-muted-foreground mx-auto opacity-50" />
              <div>
                <h3 className="text-xl font-semibold mb-2">No Students Yet</h3>
                <p className="text-muted-foreground mb-4">
                  Start by running a diagnostic assessment for your first student
                </p>
                <Button onClick={() => navigate("/diagnostic")}>
                  <Plus className="w-4 h-4 mr-2" />
                  Start First Assessment
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {studentsWithTests.map((student) => {
              const latestTest = student.tests[0];
              const totalTests = student.tests.length;
              
              return (
                <Card key={student.id} className="hover:shadow-lg transition-all">
                  <CardHeader>
                    <CardTitle>{student.name}</CardTitle>
                    <CardDescription>Age: {student.age} years old</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Total Tests:</span>
                      <Badge variant="secondary">{totalTests}</Badge>
                    </div>
                    
                    {latestTest ? (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">Last Test:</span>
                          <span className="text-sm">
                            {new Date(latestTest.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">Status:</span>
                          <Badge variant={latestTest.status === "completed" ? "default" : "outline"}>
                            {latestTest.status === "completed" ? "Completed" : "In Progress"}
                          </Badge>
                        </div>
                        
                        {latestTest.overall_severity && (
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Severity:</span>
                            <Badge 
                              variant={
                                latestTest.overall_severity === "severe" ? "destructive" :
                                latestTest.overall_severity === "moderate" ? "default" :
                                "secondary"
                              }
                            >
                              {latestTest.overall_severity}
                            </Badge>
                          </div>
                        )}
                        
                        {latestTest.blockers.length > 0 && (
                          <div className="space-y-2">
                            <span className="text-sm text-muted-foreground">Detected Blockers:</span>
                            <div className="flex flex-wrap gap-1">
                              {latestTest.blockers.slice(0, 3).map((blocker) => (
                                <Badge 
                                  key={blocker.id} 
                                  variant="outline" 
                                  className="text-xs"
                                >
                                  {blocker.blocker_name}
                                  {blocker.is_confirmed && " ✓"}
                                </Badge>
                              ))}
                              {latestTest.blockers.length > 3 && (
                                <Badge variant="outline" className="text-xs">
                                  +{latestTest.blockers.length - 3} more
                                </Badge>
                              )}
                            </div>
                          </div>
                        )}
                        
                        {latestTest.roadmap && (
                          <div className="mt-4 pt-4 border-t border-border space-y-3">
                            <h4 className="text-sm font-semibold">Remediation Roadmap</h4>
                            <div className="space-y-2">
                              {latestTest.roadmap.roadmap_data.steps.slice(0, 2).map((step) => (
                                <div key={step.step} className="text-xs bg-muted/30 rounded p-2">
                                  <div className="font-medium text-foreground">
                                    Step {step.step}: {step.title}
                                  </div>
                                  <div className="text-muted-foreground mt-1">
                                    {step.description}
                                  </div>
                                </div>
                              ))}
                              {latestTest.roadmap.roadmap_data.steps.length > 2 && (
                                <p className="text-xs text-muted-foreground text-center">
                                  +{latestTest.roadmap.roadmap_data.steps.length - 2} more steps
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No tests completed yet
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
