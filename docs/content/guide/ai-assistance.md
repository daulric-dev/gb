---
sidebar_label: AI assistance
sidebar_position: 17
---

# AI assistance

Teachers can ask an AI model for **drafts** they then check, edit and
accept:

- **Quiz questions** from a course page or pasted text.
- **Rubric feedback suggestions** while marking: a suggested level and a
  comment for each criterion, and overall feedback.
- **A summary for students** of a course page, with key points.

The AI **never marks work** and **never changes anything on its own**.
Every draft is labelled "AI-generated — review before using", and nothing is
saved until a teacher accepts it: a question is added only when the teacher
presses *Accept and add*, a rubric suggestion changes the form only when
they press *Use* (the mark is saved only with *Save mark*), and a summary
goes into the page only when they insert it and save the page.

AI assistance is **off by default**. Your organisation chooses whether to
offer it and which AI service it uses; each school can switch it off.

## For organisation admins: setting up a provider

GradeBook does not include an AI service. Your organisation **brings its
own**: requests go to your account with the provider, and the provider bills
you.

1. In **Organisation → Features**, turn on **AI assistance**.
2. **AI providers** appears in the organisation menu. Choose **Add provider**.
3. Pick the type, give it a name, the model and the API key, then save.
   You are asked to confirm it's you (a code by email): saving stores a key.
4. Press **Test** on the saved provider. A small request is sent and the
   result is shown.

The API key is stored encrypted and is **never shown again**: the page shows
only its last four characters. To change it, edit the provider and enter a
new key; leaving the field empty keeps the old one.

You can add several providers. The one marked **Default** is the
**organisation default**: schools use it unless they choose another. Each
provider can have a **monthly request limit**; when it is reached, teachers
see a message until the next calendar month.

### Which providers schools can use

The organisation decides which AI models schools can use. Schools never add
providers or API keys, and never change a provider's model: you set the model
on each provider.

- **Available to schools** (on by default) lets schools pick the provider in
  their AI settings. Turn it off for a provider you only want to test, or one
  you are phasing out. A school that had picked it goes back to the
  organisation default.
- If the **default** provider is not available to schools, schools that have
  not picked another provider get "Your organisation has not set up an AI
  provider for schools yet" until you make an available provider the default
  or they choose one.
- Removing a provider sends schools that picked it back to the organisation
  default.

Changing these settings asks you to confirm it's you and is written to the
organisation audit log.

### Anthropic (Claude)

- **API key:** create one in the Claude Console (console.anthropic.com).
- **Base URL:** leave empty. Fill it in only if your organisation routes
  requests through its own gateway (it must use `https`).
- **Model:** `claude-opus-5-5` is filled in. You can type another model id.

GradeBook uses Anthropic's official SDK, asks for structured (JSON) answers,
and turns on Anthropic's automatic fallback when the model declines a
request, so fewer requests fail.

### OpenAI-compatible services

Any service that speaks the OpenAI *chat completions* API:

| Service | Base URL (example) | Model (example) |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `gpt-5` |
| Azure OpenAI (OpenAI-compatible endpoint) | `https://<resource>.openai.azure.com/openai/v1` | your deployment name |
| OpenRouter | `https://openrouter.ai/api/v1` | `anthropic/claude-opus-5-5`, ... |
| Ollama (local) | `http://<server>:11434/v1` | `llama3.3` |
| vLLM (local) | `http://<server>:8000/v1` | the served model |
| LM Studio (local) | `http://<server>:1234/v1` | the loaded model |

The base URL is the address **before** `/chat/completions`. GradeBook asks
for a JSON answer that matches a schema; a server that cannot do that is
asked again for plain JSON, and every answer is checked before use.

### Models on your own network (Ollama, vLLM, LM Studio)

For safety, GradeBook refuses to connect a provider to private network
addresses (`10.x`, `192.168.x`, `localhost`, ...) and to plain `http`. For a
model server on your own network, tick **This provider runs on our private
network** when you add or edit that provider. Only that provider may then use
a private address and plain `http`; GradeBook still checks the address on
every request, never follows redirects, caps the answer size and times out
slow requests. Every other provider is still refused private addresses.

You **no longer need** `WEBHOOK_ALLOW_PRIVATE` for local models: that server
setting now only affects webhooks, LTI tools and OneRoster, and has no effect
on AI providers. Tick the box only for a server your organisation runs,
since it lets GradeBook's server send requests (with the provider's API key)
inside your network. A local server that needs no key accepts any text in the
API key field.

### Limits and logging

- **Requests per teacher per hour** (default 30).
- Every request is **logged**: who, which feature, the provider and model,
  tokens used and the result. The content is not stored.
- **Keep prompts for 30 days** (off by default) stores what was sent and
  received with each request, for troubleshooting, and deletes it after 30
  days. Turning it off deletes what was kept.
- Each request is also written to the school's audit log (without content).
  The request log is kept for a year.

## For school admins

In **Settings → AI assistance** (with the *Update school settings*
permission) you choose which of your organisation's AI providers your school
uses: **Organisation default** (the provider your organisation marked as
default) or any provider your organisation made available to schools. The
model is set by your organisation. The data notice under the choice names
the provider and where requests go. If your organisation later withdraws the
provider you picked, your school goes back to the organisation default.

There you also choose whether teachers may **send students' work**
to the provider for rubric feedback suggestions. It is **off by default**.
Both changes are written to the school's audit log.
To switch AI assistance off for your school entirely, use **Settings →
Features**.

## For teachers

- **Quiz questions:** in a draft quiz, choose **Draft questions with AI**.
  Pick a course page or paste text, how many questions (up to 10) and which
  types (multiple choice, true or false, short answer, multiple select,
  numeric, matching, ordering, essay). The drafts appear under the quiz as
  editable questions; check each one and press **Accept and add**, or
  **Discard**. A short "why" note with each draft is for you only and is not
  saved. Drafts that break the question rules are left out.
- **Rubric feedback:** in **Mark with rubric**, choose **Suggest levels and
  feedback with AI**. A suggestion appears under each criterion; **Use**
  copies it into the form, where you can change it. Nothing is saved until
  you press **Save mark**. This needs your school to allow sending student
  work, and the student's work must be text (files are never sent).
- **Page summary:** while editing a page, choose **Summarise for students
  with AI**. Edit the summary and key points, then insert them at the top or
  end of the page and save.

If the model declines a request, you see "The model declined this request":
reword the text or write that part yourself.

## Privacy notice

This is what happens to data when AI assistance is used:

- **Where it goes:** to the AI provider your organisation set up, named on
  the school settings card and in each AI dialog. Nothing is sent from a
  school that has AI assistance switched off.
- **What is sent:** only the text needed for the request: the course page or
  pasted text for quiz questions and summaries; for rubric feedback, the
  rubric, the activity's title and instructions, and the text the student
  handed in.
- **Names and emails are removed:** before sending, students' names are
  replaced with `[Student]` / `[Classmate]`, and email addresses and phone
  numbers with placeholders.
- **Student work** is sent only for rubric feedback suggestions, only when a
  teacher asks for one, and only if the school allows it (off by default).
  Files are never sent.
- **What is kept in GradeBook:** a log entry per request (who, feature,
  provider, model, tokens, result), without the content, for a year. Content
  is kept only if the organisation turns on prompt keeping, and then for 30
  days.
- **At the provider:** the provider's own terms and data retention apply to
  what it receives. Check them before you turn AI assistance on.
- **Decisions stay with teachers:** the AI suggests; it never marks work and
  never publishes anything to students.
