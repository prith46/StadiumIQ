import fs from 'fs';
import path from 'path';

let cachedKnowledgeBase: { section: string; content: string }[] = [];

export function loadKnowledgeBase(): { section: string; content: string }[] {
  if (cachedKnowledgeBase.length > 0) {
    return cachedKnowledgeBase;
  }

  try {
    const filePath = path.join(process.cwd(), 'data', 'knowledge.md');
    if (fs.existsSync(filePath)) {
      const markdown = fs.readFileSync(filePath, 'utf-8');
      const sections = markdown.split(/^##\s+/m);
      const chunks: { section: string; content: string }[] = [];

      for (const section of sections) {
        if (!section.trim()) continue;
        const lines = section.split('\n');
        const heading = lines[0].trim();
        const content = lines.slice(1).join('\n').trim();
        if (heading && content) {
          chunks.push({ section: heading, content });
        }
      }
      cachedKnowledgeBase = chunks;
    }
  } catch (err) {
    console.error('Failed to load knowledge base:', err);
    cachedKnowledgeBase = [];
  }

  return cachedKnowledgeBase;
}

// Pre-load on module initialization
loadKnowledgeBase();

export function retrieve(query: string, topK: number = 2): { section: string; content: string }[] {
  const kb = loadKnowledgeBase();

  const words = query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1); // skip single-char noise

  if (words.length === 0) {
    return [];
  }

  const scored = kb.map((chunk, index) => {
    const textToMatch = (chunk.section + ' ' + chunk.content).toLowerCase();
    let score = 0;
    for (const word of words) {
      // Increment score by 1 per unique query word present in the chunk
      if (textToMatch.includes(word)) {
        score++;
      }
    }
    return { chunk, score, index };
  });

  return scored
    .filter(item => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.index - b.index; // break ties by original order
    })
    .slice(0, topK)
    .map(item => item.chunk);
}
