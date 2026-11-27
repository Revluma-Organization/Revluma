-- Rev live voice calls are saved as ordinary conversations.
-- Additive-only: one new column on the backend-only rev_voice_sessions table.
--
-- A call that starts outside a conversation gets one created by the server
-- when the call starts (owns_conversation = true). The spoken turns are saved
-- into it as conversation_messages, so the call has a URL, a title and a
-- place in history exactly like a typed chat. When an owned conversation is
-- still empty after its call ends (nothing was said), the server deletes it,
-- so silent calls never leave hidden empty rows behind.

ALTER TABLE rev_voice_sessions
    ADD COLUMN IF NOT EXISTS owns_conversation boolean NOT NULL DEFAULT false;
