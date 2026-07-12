import { createLazyFileRoute } from '@tanstack/react-router'
import OperationsCredentialSecurityContent from '../content/docs/operations-credential-security.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/operations-credential-security')({
  component: () => (
    <DocsPage id="operations-credential-security">
      <OperationsCredentialSecurityContent />
    </DocsPage>
  )
})
