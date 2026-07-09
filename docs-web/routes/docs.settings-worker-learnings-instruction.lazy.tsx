import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsWorkerLearningsInstructionContent from '../content/docs/settings-worker-learnings-instruction.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-worker-learnings-instruction')({
  component: () => (
    <DocsPage id="settings-worker-learnings-instruction">
      <SettingsWorkerLearningsInstructionContent />
    </DocsPage>
  )
})
