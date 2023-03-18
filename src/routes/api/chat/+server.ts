import { OPENAI_KEY } from '$env/static/private'
import type { CreateChatCompletionRequest, ChatCompletionRequestMessage } from 'openai'
import type { RequestHandler } from './$types'
import { getTokens } from '$lib/tokenizer'
import { json } from '@sveltejs/kit'
import type { Config } from '@sveltejs/adapter-vercel'

export const config: Config = {
	runtime: 'edge'
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		if (!OPENAI_KEY) {
			throw new Error('OPENAI_KEY env variable not set')
		}

		const requestData = await request.json()

		if (!requestData) {
			throw new Error('No request data')
		}

		const reqMessages: ChatCompletionRequestMessage[] = requestData.messages

		if (!reqMessages) {
			throw new Error('no messages provided')
		}

		let tokenCount = 0

		reqMessages.forEach((msg) => {
			const tokens = getTokens(msg.content)
			tokenCount += tokens
		})

		const moderationRes = await fetch('https://api.openai.com/v1/moderations', {
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${OPENAI_KEY}`
			},
			method: 'POST',
			body: JSON.stringify({
				input: reqMessages[reqMessages.length - 1].content
			})
		})

		const moderationData = await moderationRes.json()
		const [results] = moderationData.results

		if (results.flagged) {
			throw new Error('Query flagged by openai')
		}

		const prompt =
			'As a friendly yet strict expert agile expert, your task is to coach users in improving their product backlog. You will start by critiquing a user story and providing guidance on how to enhance it with examples.Make sure to ask clarifying questions and guide users towards a better backlog by iterating on the examples you create. Ensure that each backlog item has a clearly defined user and includes the value to the user in every story.When creating acceptance criteria, focus on both customer-facing criteria and non-functional requirements like security and reliability. Your responses should be designed for easy selection and incorporation into the story. Maintain clear distinctions between your role as an assistant and the text generated for use.Output your responses as a JSON array of objects with properties "role" and "content". The roles can be either "coach" or "suggestedText". Break down your output into "suggestedText" chunks, making it simple for users to select and incorporate your suggestions.Example output formats:[{"role": "coach", "content": "Here are some examples of good acceptance criteria:"}, {"role": "suggestedText", "content": "Acceptance criteria 1..."}, {"role": "suggestedText", "content": "Acceptance criteria 2..."}, {"role": "suggestedText", "content": "Acceptance criteria 3..."}] [{"role": "coach", "content": "Here are some bullet points to help clarify the user story:"}, {"role": "suggestedText", "content": "suggestion 1"}, {"role": "suggestedText", "content": "suggestion 2"}, {"role": "suggestedText", "content": "suggestion 3"}] Remember, "suggestedText" role responses should only contain text meant to directly replace the inputted user story.'
		tokenCount += getTokens(prompt)

		if (tokenCount >= 4000) {
			throw new Error('Query too large')
		}

		const messages: ChatCompletionRequestMessage[] = [
			{ role: 'system', content: prompt },
			...reqMessages
		]

		const chatRequestOpts: CreateChatCompletionRequest = {
			model: 'gpt-3.5-turbo',
			messages,
			temperature: 0.7,
			stream: true
		}

		const chatResponse = await fetch('https://api.openai.com/v1/chat/completions', {
			headers: {
				Authorization: `Bearer ${OPENAI_KEY}`,
				'Content-Type': 'application/json'
			},
			method: 'POST',
			body: JSON.stringify(chatRequestOpts)
		})

		if (!chatResponse.ok) {
			const err = await chatResponse.json()
			throw new Error(err)
		}

		return new Response(chatResponse.body, {
			headers: {
				'Content-Type': 'text/event-stream'
			}
		})
	} catch (err) {
		console.error(err)
		return json({ error: 'There was an error processing your request' }, { status: 500 })
	}
}
