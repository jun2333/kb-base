import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'
import { config } from '../config/index.js'

export function createMarkdownChunker() {
  return new RecursiveCharacterTextSplitter({
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
    separators: [
      '\n## ',
      '\n### ',
      '\n---\n',
      '\n\n',
      '\n',
      ' ',
      '',
    ],
  })
}
