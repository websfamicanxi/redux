

# Contributing to Void

Welcome! 👋 This is a guide on how to contribute to Void. We want to make it as easy as possible to contribute, so if you have any questions or comments, reach out via email or discord!

There are two main ways to contribute:

- Suggest New Features (discord)
- Build New Features (roadmap)


See the [Roadmap](#roadmap) section for a list of the most important features to build, or feel free to build your own features.

We use a [VSCode extension](https://code.visualstudio.com/api/get-started/your-first-extension) to implement most of Void's functionality.  Scroll down to see 1. How to contribute to the Extension, or 2. How to contribute to the full IDE (for more native changes).




## Roadmap

Here are the most important topics on our Roadmap. More ⭐'s = more important.

## ⭐⭐⭐ Improve diffs.

We define a "diff" as a single green/red pair that denotes a change. Here are improvements to make:

1. Fix bugginess when the user presses "Accept" or "Reject" on a diff. One issue is that when a diff is accepted/rejected all of the diffs below should be updated (because they are now on different line numbers). There are also other miscellaneous bugs that need fixing.

4. Make diff highlighting dynamic. Right now when the user edits text, we clear all the diffs and their highlights. Instead, we should simply update the highlighting of the diff. Each diff lives on a range of lines, and all changes inside that range or intersecting with it should update its highlighting.

5. Show deletion (-) diffs. Right now we're only showing insertion (+) diffs. Diffs currently work by highlighting all of the new code in green with a simple text decoration. Instead, we would like to use code from VS Code's native diffEditor to show the diffs ("inline" mode). We could alternatively keep what we have and add red zones of the deleted code to indicate a deletion diff (-).

## ⭐⭐⭐ Build Cursor-style quick edits (ctrl+k).

When the user presses ctrl+k, an input box should appear inline with the code that they were selecting. This is somewhat difficult to do because an extension alone cannot do this, and it requires creating a new component in the IDE. We think you can modify vscode's built-in "codelens" or "zone widget" components, but we are open to alternatives.

## ⭐⭐⭐ Make History work well.
When the user submits a response or presses the apply/accept/reject button, we should add these events to the history, allowing the user to undo/redo them. Right now there is unexpected behavior if the user tries to undo or redo their changes.

## ⭐⭐⭐ Improve Ctrl+L backend.

Right now, the model outputs entire files. Instead, we should change the prompt so that the model outputs partial changes like `// ... rest of file`. When the user clicks the "Apply" button, the model should rewrite the file and apply the partial changes in the correct locations.

## ⭐⭐ Integrate with Ollama.

We have an Ollama integration coded up in the extension, but it breaks. This is because Ollama has Node.js dependencies like 'path' and 'os' which cannot run in extensions (extensions have to be able to run in the browser). To fix this, we need to migrate Void's extension so that it runs natively into the VS Code editor so that we can access Node.js.

## ⭐ One-stars.

⭐ When user presses ctrl+L it should clear the sidebar's state.

⭐ Let the user accept / reject all Diffs in an entire file via the sidebar.

⭐ Allow the user to make multiple selections of code or files at once.

⭐ Allow user to X out of their current selection.

## ⭐⭐⭐⭐ Four-stars (creative).

Feel free to build AI features beyond the standard Cursor ones. For example, creating better code search, or supporting AI agents that can edit across files and make multiple LLM calls.

Eventually, we want to build a convenient API for creating AI tools. The API will make it easy to create the UI for your tool (showing an autocomplete suggestion, or creating a new diff),  hooks for you to use on the backend (like `onKeystroke` or `onFileOpen`), and file-system functions (storing indexes associated with each file), making it much easier for you to make your own AI plugin.




## 1. Contributing to the Extension
Here's how you can start contributing to the Extension:

1. Clone the repository

 `git clone https://github.com/voideditor/void`

2. Open the extension folder

`cd /extensions/void`

3. Install dependencies

`npm run install`

4. Build the project

`npm run build`. Note: We made this build command to run React in vscode. It converts `sidebar/index.tsx` into a CSS/JS bundle in `dist/`.

5. Run the project

Press <kbd>F5</kbd>. This will start a new instance of VS Code with the extension enabled. If this does not work, you can press <kbd>F1</kbd>, select "Debug: Start Debugging", press <kbd>Enter</kbd>, and select "VS Code Extension Development".

If you would like to use AI features, you need to provide an API key. You can do that by going to Settings (<kbd>Ctrl+,</kbd>) and modifying `void > "Anthropic Api Key"`. The "Which API" environment variable controls the provider and defaults to "anthropic".

## 2. Contributing to the full IDE

Beyond the extension, we sometimes edit the IDE when we need to access more functionality. If you want to make a change to the IDE, please follow the steps below, or see VS Code's full [how to contribute](https://github.com/microsoft/vscode/wiki/How-to-Contribute) page.

1. Install all dependencies by running `yarn`.

2. Press <kbd>Ctrl+Shift+B</kbd> to start the build process - this can take some time.

3. Run `./scripts/code.sh` to open up the built IDE. To see new changes without restarting the build, use <kbd>Ctrl+Shift+P</kbd> and run "Reload Window".

To bundle the IDE, run `yarn gulp vscode-win32-x64`. Here are the full options: vscode-{win32-ia32 | win32-x64 | darwin-x64 | darwin-arm64 | linux-ia32 | linux-x64 | linux-arm}(-min)

If you're on Windows, we recommend running the project inside a dev container. VSCode should prompt you to do this automatically.



# Submitting a Pull Request

When you've made changes and want to submit them, please submit a pull request.

Please submit all Pull Requests to the `dev` branch.

























<!--

TODO we should probably just delete all this... :


### Design principles

- Least amount of eye movement necessary; if user presses submit, show them the message where they submitted


### Ctrl+L (chat)




### Ctrl+K (inline edits)

- Create a new input box that takes in the user's description.

- Make it appear above each.

- The input box should appear directly above the code selection - this requires using a Zone widget.


### Core

- Migrate the Void extension to live natively in VS Code. There's initial work here at `void.contribution.ts`.

- Allow access to the VS Code extension marketplace.

- Re-write the whole file when the user clicks "Apply" and show a gray progress indicator in the BG.



### Diffs

"Diffs" are the inline green/red highlights you see to approve or reject a change.

- Diffs are not responsive to edits right now. To make them responsive, we need to update all Diffs' ranges every time there's a change.

- Right now Diffs are only shown in green as a simple text decoration. We'd like to have them work better by using code from VS Code's native diffEditor ("inline" mode).

- **Events:** On many types of events, we should reject all the current Diffs (user submits a new chat message, clicks Apply, etc).






### Ollama

- Ollama doesn't work now because its JS library depends on Node.js and uses imports like 'path', 'os', while extensions must be able to run in the browser. When we migrate the extension into the VS Code codebase, we'll be able to access Node.js and will uncomment the Ollama integration.

### Greptile

- Ideally we'd auto-detect -->
