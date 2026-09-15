from google import genai
from google.genai import types
import base64
import os

def generate():
  client = genai.Client(
      vertexai=True,
      api_key=os.environ.get("GOOGLE_CLOUD_API_KEY"),
  )

  msg1_video1 = types.Part.from_uri(
      file_uri="https://www.youtube.com/watch?v=3KtWfp0UopM",
      mime_type="video/*",
  )
  msg1_text1 = types.Part.from_text(text="""You are given a video about \"the most searched something\" on Google Search. Please watch the video and generate structured description of it. The description should include a short summary no more than 100 words, followed by descriptions for each most searched something mentioned in the video. Use a time-dependent JSON format for the description as follows: {\"Summary\": <summary of the video, less than 100 words>, \"Details\": [ {\"MM:SS~MM:SS\" : { \"the most searched first step in history\": \"Moon landing by Neil Armstrong\"}}, {\"MM:SS-MM:SS\": {\"the most searched sport\": \"soccer\"}, ... ] }.""")

  model = "gemini-3.8-flash"
  contents = [
    types.Content(
      role="user",
      parts=[
        msg1_video1,
        msg1_text1
      ]
    ),
  ]

  generate_content_config = types.GenerateContentConfig(
    max_output_tokens = 65535,
    safety_settings = [types.SafetySetting(
      category="HARM_CATEGORY_HATE_SPEECH",
      threshold="OFF"
    ),types.SafetySetting(
      category="HARM_CATEGORY_DANGEROUS_CONTENT",
      threshold="OFF"
    ),types.SafetySetting(
      category="HARM_CATEGORY_SEXUALLY_EXPLICIT",
      threshold="OFF"
    ),types.SafetySetting(
      category="HARM_CATEGORY_HARASSMENT",
      threshold="OFF"
    )],
    thinking_config=types.ThinkingConfig(
      thinking_level="MEDIUM",
    ),
  )

  for chunk in client.models.generate_content_stream(
    model = model,
    contents = contents,
    config = generate_content_config,
    ):
    print(chunk.text, end="")

generate()