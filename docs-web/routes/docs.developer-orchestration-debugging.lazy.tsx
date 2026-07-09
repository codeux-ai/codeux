import { createLazyFileRoute } from '@tanstack/react-router'
import DeveloperOrchestrationDebuggingContent from '../content/docs/developer-orchestration-debugging.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/developer-orchestration-debugging')({
  component: () => (
    <DocsPage id="developer-orchestration-debugging">
      <DeveloperOrchestrationDebuggingContent />
    </DocsPage>
  )
})
