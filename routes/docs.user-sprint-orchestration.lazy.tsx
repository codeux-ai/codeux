import { createLazyFileRoute } from '@tanstack/react-router'
import UserSprintOrchestrationContent from '../content/docs/user-sprint-orchestration.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-sprint-orchestration')({
  component: () => (
    <DocsPage id="user-sprint-orchestration">
      <UserSprintOrchestrationContent />
    </DocsPage>
  )
})
