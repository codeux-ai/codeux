# Manage Billing and Subscriptions

Help manage your subscriptions, view invoices, and update payment details without contacting support.

## Before you start

* You must have an Owner role in your workspace to access and modify billing settings.
* Have your new credit card details ready if you are updating your payment method.

::: info
Billing is calculated based on active seats. There is a distinction between active seats and invited/pending seats:
* **Active seats**: Users who have accepted their invitation and joined the workspace. You are billed for these users.
* **Invited/pending seats**: Users who have been sent an invitation but have not yet accepted it. You are not billed for these users until they accept the invitation and become active.
:::

## Steps

### Update Credit Card Details

1. Log in to your workspace.
2. Click on **Settings** in the main navigation menu.
3. Select the **Billing** tab.
4. Under the Payment Method section, click **Update Payment Method**.
5. Enter your new credit card information and click **Save Changes**.

### View Past Invoices

1. Log in to your workspace.
2. Navigate to **Settings** and select the **Billing** tab.
3. Scroll down to the **Invoice History** section.
4. Click **Download** next to any invoice to view its details.

### How Prorated Billing Works

When you add or remove users during a billing cycle, your invoice is prorated based on the exact time the seat was active.

* **Adding a user**: If you are on a $30/month plan and add a user exactly halfway through your 30-day billing cycle, you are only billed for the remaining 15 days.
  * *Pricing math*: $30 / 30 days = $1 per day. 15 days remaining * $1/day = $15 charge for the new user on your next invoice.
* **Removing a user**: If you remove a user halfway through the billing cycle, you receive a prorated credit for the unused time.
  * *Pricing math*: 15 unused days * $1/day = $15 credit applied to your next invoice.

### Troubleshooting: Payment Failed

If you encounter a **Payment Failed** error, your subscription may be temporarily suspended. To resolve this:

1. Check that your credit card has not expired.
2. Ensure you have sufficient funds or contact your bank to authorize the transaction.
3. Follow the steps above to **Update Payment Method** with a valid card.
4. Once updated, click **Retry Payment** in the **Billing** tab to restore your active subscription.

## Expected result

You should be able to successfully update your payment method, access past invoices, and understand your billing charges. Your billing status should reflect "Active" under the **Billing** tab.
