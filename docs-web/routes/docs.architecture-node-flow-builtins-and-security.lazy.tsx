import { createLazyFileRoute } from '@tanstack/react-router'
import ArchitectureNodeFlowBuiltinsAndSecurityContent from '../content/docs/architecture-node-flow-builtins-and-security.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/architecture-node-flow-builtins-and-security')({
  component: () => (
    <DocsPage id="architecture-node-flow-builtins-and-security">
      <ArchitectureNodeFlowBuiltinsAndSecurityContent />
    </DocsPage>
  )
})
