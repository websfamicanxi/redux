import React, { JSX, useCallback, useEffect, useState } from "react"
import { marked, MarkedToken, Token, TokensList } from "marked"
import BlockCode from "./BlockCode"
import { getVSCodeAPI } from "../../common/getVscodeApi"


enum CopyButtonState {
	Copy = "Copy",
	Copied = "Copied!",
	Error = "Could not copy",
}

const COPY_FEEDBACK_TIMEOUT = 1000 // amount of time to say 'Copied!'

const CodeButtonsOnHover = ({ diffRepr: text }: { diffRepr: string }) => {
	const [copyButtonState, setCopyButtonState] = useState(CopyButtonState.Copy)

	useEffect(() => {
		if (copyButtonState !== CopyButtonState.Copy) {
			setTimeout(() => {
				setCopyButtonState(CopyButtonState.Copy)
			}, COPY_FEEDBACK_TIMEOUT)
		}
	}, [copyButtonState])

	const onCopy = useCallback(() => {
		navigator.clipboard.writeText(text).then(
			() => {
				setCopyButtonState(CopyButtonState.Copied)
			},
			() => {
				setCopyButtonState(CopyButtonState.Error)
			}
		)
	}, [text])

	return <>
		<button
			className="btn btn-secondary btn-sm border border-vscode-input-border rounded"
			onClick={onCopy}
		>
			{copyButtonState}
		</button>
		<button
			className="btn btn-secondary btn-sm border border-vscode-input-border rounded"
			onClick={async () => {
				getVSCodeAPI().postMessage({ type: "applyChanges", diffRepr: text })
			}}
		>
			Apply
		</button>
	</>
}


const RenderToken = ({ token, nested = false }: { token: Token | string, nested?: boolean }): JSX.Element => {

	// deal with built-in tokens first (assume marked token)
	const t = token as MarkedToken

	if (t.type === "space") {
		return <span>{t.raw}</span>
	}

	if (t.type === "code") {
		return <BlockCode
			text={t.text}
			language={t.lang}
			buttonsOnHover={<CodeButtonsOnHover diffRepr={t.text} />}
		/>
	}

	if (t.type === "heading") {
		const HeadingTag = `h${t.depth}` as keyof JSX.IntrinsicElements
		return <HeadingTag>{t.text}</HeadingTag>
	}

	if (t.type === "table") {
		return (
			<table>
				<thead>
					<tr>
						{t.header.map((cell: any, index: number) => (
							<th key={index} style={{ textAlign: t.align[index] || "left" }}>
								{cell.raw}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{t.rows.map((row: any[], rowIndex: number) => (
						<tr key={rowIndex}>
							{row.map((cell: any, cellIndex: number) => (
								<td
									key={cellIndex}
									style={{ textAlign: t.align[cellIndex] || "left" }}
								>
									{cell.raw}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		)
	}

	if (t.type === "hr") {
		return <hr />
	}

	if (t.type === "blockquote") {
		return <blockquote>{t.text}</blockquote>
	}

	if (t.type === "list") {
		const ListTag = t.ordered ? "ol" : "ul"
		return (
			<ListTag
				start={t.start ? t.start : undefined}
				className={`list-inside ${t.ordered ? "list-decimal" : "list-disc"}`}
			>
				{t.items.map((item, index) => (
					<li key={index}>
						{item.task && (
							<input type="checkbox" checked={item.checked} readOnly />
						)}
						<MarkdownRender string={item.text} nested={true} />
					</li>
				))}
			</ListTag>
		)
	}

	if (t.type === "paragraph") {
		const contents = <>
			{t.tokens.map((token, index) => (
				<RenderToken key={index} token={token} />
			))}
		</>
		if (nested)
			return contents
		return <p>{contents}</p>
	}

	// don't actually render <html> tags, just render strings of them
	if (t.type === "html") {
		return (
			<pre>
				{`<html>`}
				{t.raw}
				{`</html>`}
			</pre>
		)
	}

	if (t.type === "text" || t.type === "escape") {
		return <span>{t.raw}</span>
	}

	if (t.type === "def") {
		return <></> // Definitions are typically not rendered
	}

	if (t.type === "link") {
		return (
			<a href={t.href} title={t.title ?? undefined}>
				{t.text}
			</a>
		)
	}

	if (t.type === "image") {
		return <img src={t.href} alt={t.text} title={t.title ?? undefined} />
	}

	if (t.type === "strong") {
		return <strong>{t.text}</strong>
	}

	if (t.type === "em") {
		return <em>{t.text}</em>
	}

	// inline code
	if (t.type === "codespan") {
		return (
			<code className="text-vscode-editor-fg bg-vscode-editor-bg px-1 rounded-sm font-mono">
				{t.text}
			</code>
		)
	}

	if (t.type === "br") {
		return <br />
	}

	// strikethrough
	if (t.type === "del") {
		return <del>{t.text}</del>
	}

	// default
	return (
		<div className="bg-orange-50 rounded-sm overflow-hidden">
			<span className="text-xs text-orange-500">Unknown type:</span>
			{t.raw}
		</div>
	)
}

const MarkdownRender = ({ string, nested = false }: { string: string, nested?: boolean }) => {
	const tokens = marked.lexer(string); // https://marked.js.org/using_pro#renderer
	return (
		<>
			{tokens.map((token, index) => (
				<RenderToken key={index} token={token} nested={nested} />
			))}
		</>
	)
}

export default MarkdownRender
