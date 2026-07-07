import { createLazyFileRoute } from '@tanstack/react-router'
import UserInstallationContent from '../content/docs/user-installation.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/user-installation')({
  component: () => (
    <DocsPage id="user-installation">
      <UserInstallationContent />
    </DocsPage>
  )
})
