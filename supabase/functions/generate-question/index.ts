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
    const { age, errorHistory } = await req.json();
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Build a prompt that adapts based on error history
    const errorContext = errorHistory && errorHistory.length > 0
      ? `The student has struggled with: ${errorHistory.map((e: any) => e.construct).join(', ')}. Adjust difficulty accordingly.`
      : '';

    const systemPrompt = `You are a dyscalculia diagnostic expert. Generate ONE adaptive math question for a ${age}-year-old student.
    
${errorContext}

The question should test one of these mathematical constructs:
- Number Sense (magnitude comparison, number line understanding)
- Place Value (understanding tens, hundreds, etc.)
- Basic Arithmetic (addition, subtraction appropriate for age)
- Pattern Recognition
- Spatial Reasoning
- Working Memory (multi-step problems)

Return ONLY a JSON object with this exact structure:
{
  "questionText": "Clear question text",
  "correctAnswer": "The correct answer",
  "construct": "Construct being tested",
  "difficultyLevel": 1-5
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
          { role: "user", content: `Generate a diagnostic math question for age ${age}.` }
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
    
    const question = JSON.parse(jsonMatch[0]);

    return new Response(
      JSON.stringify(question),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in generate-question:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
