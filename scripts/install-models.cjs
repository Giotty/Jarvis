const base = 'http://127.0.0.1:11434';
async function pull(model) {
  const response = await fetch(base + '/api/pull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: true }),
  });
  if (!response.ok) throw Error(`Pull ${model}: HTTP ${response.status}`);
  let buffer = '',
    last = 0;
  for await (const chunk of response.body) {
    buffer += Buffer.from(chunk).toString('utf8');
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const entry = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      if (entry.error) throw Error(entry.error);
      if (entry.status === 'success') {
        console.log(`${model}: installed`);
        continue;
      }
      if (Date.now() - last > 30000) {
        last = Date.now();
        console.log(
          `${model}: ${entry.total ? Math.round((100 * (entry.completed || 0)) / entry.total) + '%' : entry.status}`,
        );
      }
    }
  }
}
Promise.all(['qwen3.5:9b'].map(pull)).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
