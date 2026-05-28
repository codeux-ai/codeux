# App Performance Troubleshooting

By the end of this guide, you will be able to improve app performance by toggling hardware acceleration, archiving old tasks, and generating performance profiles to send to support.

::: info
These steps provide constructive tuning options for the app. The app performance depends on various factors and following these guidelines should help.
:::

## Before you start
* Access to the app's settings menu
* The ability to archive tasks if you are a project administrator

## Steps

1. **Toggle Hardware Acceleration**
   If you are experiencing lag or graphical glitches in the Electron app, toggling hardware acceleration can often help.

   1. Open the app **Settings**.
   2. Navigate to the **Advanced** tab.
   3. Locate the **Hardware Acceleration** setting.
   4. Toggle the switch off (if on) or on (if off) to see if performance improves.
   5. Restart the application for the changes to take effect.

2. **Manage Large Project Sizes**
   Very large projects with many active tasks can slow down initial load times.

   1. Navigate to your project view.
   2. Select tasks that are complete or no longer relevant.
   3. Click **Archive** to remove them from the active view. This helps speed up the initial load time.

3. **Gather Performance Logs**
   If the issues persist, you can gather a performance profile or log to share with our support team.

   1. Open the app **Settings**.
   2. Navigate to the **Support** tab.
   3. Click on **Export Performance Profile**.
   4. Save the `.json` file to a safe location on your computer.
   5. Email this file to our support team for further analysis.

## Expected Result
You should experience improved app performance after following the tuning options, or you will have generated a performance profile that you can send to support for further help.
