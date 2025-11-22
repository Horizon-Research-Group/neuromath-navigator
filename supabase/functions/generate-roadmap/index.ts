import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { age, blockers, responses } = await req.json();
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const blockersText = blockers.map((b: any) => `${b.blocker_name} (${b.error_count} errors)`).join(', ');
    
    const systemPrompt = `You are an expert dyscalculia remediation specialist. Based on the diagnostic test results, create a personalized 5-step remediation roadmap.

Student Profile:
- Age: ${age} years old
- Detected Blockers: ${blockersText}
- Total Test Responses: ${responses.length}

Create a comprehensive, actionable 5-step roadmap. Each step must include:
1. A clear, actionable goal title
2. Detailed execution plan (day-wise or weekly breakdown)
3. Specific resource/tool recommendations (apps, websites, worksheets, manipulatives)

Return ONLY a JSON object with this exact structure:
{
  "overallSeverity": "none" | "mild" | "moderate" | "severe",
  "summary": "Brief assessment summary",
  "steps": [
    {
      "stepNumber": 1,
      "title": "Actionable goal title",
      "executionPlan": "Detailed day-wise/weekly plan",
      "resources": ["Specific resource 1", "Specific resource 2"]
    },
    // ... 5 steps total
  ]
}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Generate the personalized remediation roadmap." }
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required. Please add credits to your workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    
    // Extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to extract JSON from AI response");
    }
    
    const roadmap = JSON.parse(jsonMatch[0]);

    return new Response(
      JSON.stringify(roadmap),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in generate-roadmap:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
