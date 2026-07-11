import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureSpeechInputContent from '../content/docs/architecture-speech-input.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-speech-input')({
  component: () => (
    <DocsPage id="architecture-speech-input">
      <ArchitectureSpeechInputContent />
    </DocsPage>
  )
})
