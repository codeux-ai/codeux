import { createLazyFileRoute } from '@tanstack/react-router'
import OperationsSecurityHardeningContent from '../content/docs/operations-security-hardening.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/operations-security-hardening')({
  component: () => (
    <DocsPage id="operations-security-hardening">
      <OperationsSecurityHardeningContent />
    </DocsPage>
  )
})
