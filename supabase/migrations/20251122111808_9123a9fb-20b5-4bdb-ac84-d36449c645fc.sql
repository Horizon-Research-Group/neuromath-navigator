-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create enum for test status
CREATE TYPE test_status AS ENUM ('in_progress', 'completed');

-- Create enum for severity levels
CREATE TYPE severity_level AS ENUM ('none', 'mild', 'moderate', 'severe');

-- Create profiles table for users
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT DEFAULT 'teacher',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create students table
CREATE TABLE public.students (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  teacher_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  age INTEGER NOT NULL CHECK (age >= 5),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create diagnostic tests table
CREATE TABLE public.diagnostic_tests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  status test_status DEFAULT 'in_progress',
  age_at_test INTEGER NOT NULL,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  overall_severity severity_level DEFAULT 'none',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create test responses table
CREATE TABLE public.test_responses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  test_id UUID NOT NULL REFERENCES public.diagnostic_tests(id) ON DELETE CASCADE,
  question_number INTEGER NOT NULL,
  question_text TEXT NOT NULL,
  user_answer TEXT,
  correct_answer TEXT NOT NULL,
  is_correct BOOLEAN NOT NULL,
  construct_tested TEXT NOT NULL,
  difficulty_level INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create blockers detected table
CREATE TABLE public.blockers_detected (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  test_id UUID NOT NULL REFERENCES public.diagnostic_tests(id) ON DELETE CASCADE,
  blocker_name TEXT NOT NULL,
  error_count INTEGER NOT NULL,
  is_confirmed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create remediation roadmaps table
CREATE TABLE public.remediation_roadmaps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  test_id UUID NOT NULL REFERENCES public.diagnostic_tests(id) ON DELETE CASCADE,
  roadmap_data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnostic_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blockers_detected ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remediation_roadmaps ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profiles
CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- RLS Policies for students
CREATE POLICY "Teachers can view their own students"
  ON public.students FOR SELECT
  USING (auth.uid() = teacher_id);

CREATE POLICY "Teachers can create students"
  ON public.students FOR INSERT
  WITH CHECK (auth.uid() = teacher_id);

CREATE POLICY "Teachers can update their students"
  ON public.students FOR UPDATE
  USING (auth.uid() = teacher_id);

CREATE POLICY "Teachers can delete their students"
  ON public.students FOR DELETE
  USING (auth.uid() = teacher_id);

-- RLS Policies for diagnostic tests
CREATE POLICY "Teachers can view tests for their students"
  ON public.diagnostic_tests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.students
      WHERE students.id = diagnostic_tests.student_id
      AND students.teacher_id = auth.uid()
    )
  );

CREATE POLICY "Teachers can create tests for their students"
  ON public.diagnostic_tests FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.students
      WHERE students.id = student_id
      AND students.teacher_id = auth.uid()
    )
  );

CREATE POLICY "Teachers can update tests for their students"
  ON public.diagnostic_tests FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.students
      WHERE students.id = diagnostic_tests.student_id
      AND students.teacher_id = auth.uid()
    )
  );

-- RLS Policies for test responses
CREATE POLICY "Teachers can view responses for their students' tests"
  ON public.test_responses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.diagnostic_tests dt
      JOIN public.students s ON dt.student_id = s.id
      WHERE dt.id = test_responses.test_id
      AND s.teacher_id = auth.uid()
    )
  );

CREATE POLICY "Teachers can create responses for their students' tests"
  ON public.test_responses FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.diagnostic_tests dt
      JOIN public.students s ON dt.student_id = s.id
      WHERE dt.id = test_id
      AND s.teacher_id = auth.uid()
    )
  );

-- RLS Policies for blockers
CREATE POLICY "Teachers can view blockers for their students' tests"
  ON public.blockers_detected FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.diagnostic_tests dt
      JOIN public.students s ON dt.student_id = s.id
      WHERE dt.id = blockers_detected.test_id
      AND s.teacher_id = auth.uid()
    )
  );

CREATE POLICY "Teachers can create blockers for their students' tests"
  ON public.blockers_detected FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.diagnostic_tests dt
      JOIN public.students s ON dt.student_id = s.id
      WHERE dt.id = test_id
      AND s.teacher_id = auth.uid()
    )
  );

CREATE POLICY "Teachers can update blockers for their students' tests"
  ON public.blockers_detected FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.diagnostic_tests dt
      JOIN public.students s ON dt.student_id = s.id
      WHERE dt.id = blockers_detected.test_id
      AND s.teacher_id = auth.uid()
    )
  );

-- RLS Policies for roadmaps
CREATE POLICY "Teachers can view roadmaps for their students' tests"
  ON public.remediation_roadmaps FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.diagnostic_tests dt
      JOIN public.students s ON dt.student_id = s.id
      WHERE dt.id = remediation_roadmaps.test_id
      AND s.teacher_id = auth.uid()
    )
  );

CREATE POLICY "Teachers can create roadmaps for their students' tests"
  ON public.remediation_roadmaps FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.diagnostic_tests dt
      JOIN public.students s ON dt.student_id = s.id
      WHERE dt.id = test_id
      AND s.teacher_id = auth.uid()
    )
  );

-- Trigger to auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_students_updated_at
  BEFORE UPDATE ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_diagnostic_tests_updated_at
  BEFORE UPDATE ON public.diagnostic_tests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();