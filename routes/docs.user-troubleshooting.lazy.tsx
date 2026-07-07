import { createLazyFileRoute } from '@tanstack/react-router'
import UserTroubleshootingContent from '../content/docs/user-troubleshooting.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-troubleshooting')({
  component: () => (
    <DocsPage id="user-troubleshooting">
      <UserTroubleshootingContent />
    </DocsPage>
  )
})
