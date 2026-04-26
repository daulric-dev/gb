export function prompt(label: string): Promise<string> {
  process.stdout.write(`\x1b[1m${label}\x1b[0m `);
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const handler = (chunk: Buffer) => {
      chunks.push(chunk);
      const input = Buffer.concat(chunks).toString().trim();
      if (input.includes("\n") || chunk.toString().includes("\n")) {
        process.stdin.removeListener("data", handler);
        process.stdin.pause();
        resolve(input.split("\n")[0].trim());
      } else {
        process.stdin.removeListener("data", handler);
        process.stdin.pause();
        resolve(input);
      }
    };
    process.stdin.resume();
    process.stdin.on("data", handler);
  });
}

export function promptWithWordLimit(label: string, maxWords: number): Promise<string> {
  return new Promise((resolve) => {
    let input = "";

    const render = () => {
      const words = input.trim() ? input.trim().split(/\s+/) : [];
      const count = words.length;
      const counter =
        count > maxWords
          ? `\x1b[31m(${count}/${maxWords} words)\x1b[0m`
          : `\x1b[90m(${count}/${maxWords} words)\x1b[0m`;
      process.stdout.write(`\r\x1b[2K\x1b[1m${label}\x1b[0m ${input}${counter}`);
      process.stdout.write(`\x1b[${counter.replace(/\x1b\[[^m]*m/g, "").length}D`);
    };

    render();
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const handler = (data: Buffer) => {
      const key = data.toString();

      if (key === "\r" || key === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", handler);
        const words = input.trim().split(/\s+/);
        if (input.trim() && words.length > maxWords) {
          process.stdout.write(`\r\x1b[2K\x1b[33mTopic trimmed to ${maxWords} words.\x1b[0m\n`);
          input = words.slice(0, maxWords).join(" ");
        } else {
          process.stdout.write("\n");
        }
        resolve(input.trim());
      } else if (key === "\x7f" || key === "\b") {
        if (input.length > 0) {
          input = input.slice(0, -1);
          render();
        }
      } else if (key === "\x03") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", handler);
        process.stdout.write("\n");
        process.exit(130);
      } else if (key === "\x17") {
        input = input.replace(/\s*\S+\s*$/, "");
        render();
      } else if (!key.startsWith("\x1b") && key >= " ") {
        input += key;
        render();
      }
    };
    process.stdin.on("data", handler);
  });
}

export function select(label: string, options: string[]): Promise<string> {
  return new Promise((resolve) => {
    let cursor = 0;

    const render = () => {
      if (rendered) {
        process.stdout.write(`\x1b[${options.length}A`);
      }
      for (let i = 0; i < options.length; i++) {
        const marker = i === cursor ? "\x1b[36m❯\x1b[0m" : " ";
        const text = i === cursor ? `\x1b[1m${options[i]}\x1b[0m` : options[i];
        process.stdout.write(`\x1b[2K${marker} ${text}\n`);
      }
    };

    let rendered = false;
    console.log(`\x1b[1m${label}\x1b[0m`);
    render();
    rendered = true;

    process.stdin.setRawMode(true);
    process.stdin.resume();
    const handler = (data: Buffer) => {
      const key = data.toString();

      if (key === "\x1b[A" && cursor > 0) {
        cursor--;
        render();
      } else if (key === "\x1b[B" && cursor < options.length - 1) {
        cursor++;
        render();
      } else if (key === "\r" || key === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", handler);
        resolve(options[cursor]);
      } else if (key === "\x03") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", handler);
        process.exit(130);
      }
    };
    process.stdin.on("data", handler);
  });
}
