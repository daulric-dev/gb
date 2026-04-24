# Interactive Prompts

**Location**: `command/prompts.ts`

The CLI uses custom interactive terminal prompts built directly on Node.js `process.stdin` with raw mode. No external prompt libraries are used.

## Prompt Types

### `prompt(label)`

A simple single-line text input.

```
Message (optional): your text here
```

Reads from stdin until Enter is pressed. Returns the trimmed input string (can be empty).

### `promptWithWordLimit(label, maxWords)`

A text input with a live word counter that updates as you type.

```
Topic (required): add avatar upload (3/10 words)
```

**Behavior:**
- Displays a rolling `(count/max words)` counter after the input text
- Counter turns **red** when the word limit is exceeded
- On Enter, if the input exceeds the limit, it is automatically trimmed to `maxWords` words with a warning message
- Supports backspace, Ctrl+W (delete last word), and Ctrl+C (exit)

### `select(label, options)`

An arrow-key navigable selection list.

```
Select a service:
❯ frontend
  backend
  docs
  .github
  command
  root
```

**Behavior:**
- Up/Down arrows move the cursor (`❯` marker)
- The selected option is displayed in **bold**
- Enter confirms the selection
- Ctrl+C exits the process
- Returns the selected option string

## Raw Mode

All interactive prompts use `process.stdin.setRawMode(true)` to capture individual keypresses. Raw mode is always restored (`setRawMode(false)`) before returning, including on Ctrl+C exits.

## Supported Key Bindings

| Key | Action |
|-----|--------|
| Enter | Confirm input / selection |
| Backspace | Delete last character |
| Ctrl+W | Delete last word (prompt with word limit) |
| Ctrl+C | Exit process (code 130) |
| Up Arrow | Move selection up |
| Down Arrow | Move selection down |
