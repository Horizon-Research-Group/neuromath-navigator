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

export default function Dashboard() {
  const [session, setSession] = useState<Session | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
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
      const { data, error } = await supabase
        .from("students")
        .select("*")
        .eq("teacher_id", userId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setStudents(data || []);
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
        ) : students.length === 0 ? (
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
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {students.map((student) => (
              <Card key={student.id} className="hover:shadow-lg transition-all">
                <CardHeader>
                  <CardTitle>{student.name}</CardTitle>
                  <CardDescription>Age: {student.age} years old</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Last Test:</span>
                    <span className="text-sm">
                      {new Date(student.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Status:</span>
                    <Badge variant="outline">Assessment Complete</Badge>
                  </div>
                  <Button variant="outline" className="w-full mt-4">
                    View Roadmap
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
