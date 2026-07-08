import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsGuardrailsContent from '../content/docs/settings-guardrails.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-guardrails')({
  component: () => (
    <DocsPage id="settings-guardrails">
      <SettingsGuardrailsContent />
    </DocsPage>
  )
})
