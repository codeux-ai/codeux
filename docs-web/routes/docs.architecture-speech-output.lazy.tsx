import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureSpeechOutputContent from '../content/docs/architecture-speech-output.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-speech-output')({
  component: () => (
    <DocsPage id="architecture-speech-output">
      <ArchitectureSpeechOutputContent />
    </DocsPage>
  )
})
