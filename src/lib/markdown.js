/**
 * Tiny Markdown renderer — just enough for lesson notes and course.md:
 * headings, bold, italic, inline code, fenced code blocks, lists,
 * links and paragraphs. HTML is escaped first, so notes can't inject
 * markup into the app.
 */

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function inline(s) {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
}

export function renderMarkdown(md) {
  if (!md) return ''
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  let html = ''
  let inCode = false
  let inList = false

  const closeList = () => {
    if (inList) { html += '</ul>'; inList = false }
  }

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCode) { html += '</code></pre>'; inCode = false }
      else { closeList(); html += '<pre><code>'; inCode = true }
      continue
    }
    if (inCode) {
      html += escapeHtml(line) + '\n'
      continue
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    const listItem = line.match(/^\s*[-*]\s+(.*)$/)
    const numbered = line.match(/^\s*\d+\.\s+(.*)$/)

    if (heading) {
      closeList()
      const level = heading[1].length
      html += `<h${level}>${inline(heading[2])}</h${level}>`
    } else if (listItem || numbered) {
      if (!inList) { html += '<ul>'; inList = true }
      html += `<li>${inline(listItem ? listItem[1] : numbered[1])}</li>`
    } else if (line.trim() === '') {
      closeList()
    } else {
      closeList()
      html += `<p>${inline(line)}</p>`
    }
  }
  closeList()
  if (inCode) html += '</code></pre>'
  return html
}
