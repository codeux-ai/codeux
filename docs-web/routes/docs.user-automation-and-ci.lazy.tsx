import { createLazyFileRoute } from '@tanstack/react-router'
import UserAutomationAndCiContent from '../content/docs/user-automation-and-ci.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-automation-and-ci')({
  component: () => (
    <DocsPage id="user-automation-and-ci">
      <UserAutomationAndCiContent />
    </DocsPage>
  )
})
