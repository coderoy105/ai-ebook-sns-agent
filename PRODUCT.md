# AI Book Studio — Product Truth

## Product
AI Book Studio is a production web app for planning, generating, editing, preserving, and exporting complete books. It is not a demo chat wrapper: a book is a durable project with a blueprint, outline, section manuscripts, generation state, revisions, progress, and export artifacts.

## Core user job
A user should be able to start with a short idea and move continuously from planning to a finished manuscript without losing work or manually coordinating multiple AI chats.

## Primary workflow
1. Describe the book idea.
2. Choose book type, reader, voice, length, and design DNA.
3. Generate the book blueprint and outline.
4. Generate manuscript section by section.
5. Persist every completed section so generation can pause and resume.
6. Edit manually or request targeted AI rewrites.
7. Review versions and quality state.
8. Export PDF, EPUB, DOCX, Markdown, or text.

## Free AI constraint
The public free path uses the user's OpenRouter connection and free models. Free request limits can interrupt a long book, so the interface must make saved progress and resumability obvious. A pause is a normal recoverable state, not a catastrophic failure.

## Audience
People who want to create long-form books with AI but do not want to manage prompts, continuity, files, and partial drafts across many separate tools. The product must remain understandable to a non-developer while still exposing enough state to feel trustworthy.

## Product character
- Operational, not promotional.
- Serious enough for long writing sessions.
- Clear about what the AI is doing now and what has already been saved.
- Fast to scan when several books are in progress.
- Manuscript-first: interface chrome should never visually dominate the text being written.

## Must preserve
- Email/password authentication.
- Existing Supabase data and PhonePlay coexistence.
- Free OpenRouter flow and browser-session key handling.
- Section-by-section generation and resumability.
- Revision history and manual editing.
- Export formats and generation progress.
- Desktop and mobile usability.
