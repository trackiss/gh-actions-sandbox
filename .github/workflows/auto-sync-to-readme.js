const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const createReadStream = require('fs')
const FormData = require('form-data')
const stream = require('stream')

exports.generatePreview = async ({ github, context, core }) => {
  const { GITHUB_HEAD_REF, README_API_KEY } = process.env

  if (typeof GITHUB_HEAD_REF === 'undefined') {
    core.setFailed('An environment variable `GITHUB_HEAD_REF` is not set.')
    return
  }

  if (typeof README_API_KEY === 'undefined') {
    core.setFailed('An environment variable `README_API_KEY` is not set.')
    return
  }

  // 英数字以外はハイフンに置き換える
  const versionId = 'v2-' + GITHUB_HEAD_REF.replace(/[^a-zA-Z0-9]/g, '-')

    (async () => {
      // ReadMeのバージョンを取得する
      const fetchVersionResponse = await fetchReadMe('GET', '/version/' + versionId)
        .then(response => {
          if (!response.ok && response.status !== 404) {
            return Promise.reject(createErrorMessage('Failed to fetch version.', response.json()))
          }

          return response
        });

      if (fetchVersionResponse.ok) {
        // 更新対象となるOpenAPI仕様のIDを取得する
        /** @type {string} */
        const openapiSpecId = await fetchReadMe('GET', `/version/${versionId}`)
          .then(response => {
            const json = response.json()

            if (!response.ok) {
              return Promise.reject(createErrorMessage('Failed to fetch OpenAPI Specs.', json))
            }

            const id = json.filter(spec => spec.title === 'Swagger Petstore')[0]["_id"]

            if (typeof id === 'undefined') {
              return Promise.reject(
                createErrorMessage('A target OpenAPI Spec does not exist.', fetchOpenAPISpecsResponseJson)
              )
            }

            return id
          })

        // OpenAPI仕様を更新する
        const updateOpenAPISpecFormData = new FormData()
        updateOpenAPISpecFormData.append('spec', createReadStream('./openapi/openapi.yaml'))

        await fetchReadMe('PUT', `/api-specification/${openapiSpecId}`, updateOpenAPISpecFormData)
          .then(response => {
            if (!response.ok) {
              return Promise.reject(createErrorMessage('Failed to update OpenAPI Spec.', response.json()));
            }
          })
      } else if (fetchVersionResponse.status === 404) {
        // ReadMeのバージョンを作成する
        const createVersionFormData = new FormData()
        createVersionFormData.append('version', versionId)
        createVersionFormData.append('codename', GITHUB_HEAD_REF)
        createVersionFormData.append('from', 'v2')
        createVersionFormData.append('is_stable', false)
        createVersionFormData.append('is_beta', false)
        createVersionFormData.append('is_hidden', true)

        await fetchReadMe('POST', '/version', createVersionFormData)
          .then(response => {
            if (!response.ok) {
              return Promise.reject(createErrorMessage('Failed to create version.', response.json()));
            }
          })

        // OpenAPI仕様をアップロードする
        const uploadOpenAPISpecFormData = new FormData()
        uploadOpenAPISpecFormData.append('spec', createReadStream('./openapi/openapi.yaml'))

        await fetchReadMe('POST', '/api-specification', uploadOpenAPISpecFormData)
          .then(response => {
            if (!response.ok) {
              return Promise.reject(createErrorMessage('Failed to upload OpenAPI Spec.', response.json()));
            }
          })
      } else {
        return Promise.reject(createErrorMessage('Failed to fetch version.', response.json()))
      }
    })()
    .then(() => github.rest.issues.createComment({
      issue_number: context.issue.number,
      owner: context.repo.owner,
      repo: context.repo.repo,
      body: `Preview link here: https://trackiss.readme.io/${versionId}/reference`
    }))
    .catch(message => core.setFailed(message))
};

/**
 * fetch with ReadMe.com
 * @param {string} method
 * @param {string} path
 * @param {string|stream.Readable} body
 * @param {Object} headers
 * @returns {Promise<fetch.Response>} response
 */
function fetchReadMe(method, path, body, headers) {
  const readmeAPIKey = process.env.README_API_KEY

  if (typeof readmeAPIKey === 'undefined') {
    return Promise.reject('`README_API_KEY` environment variable is not set.')
  }

  const params = {
    method: method,
    headers: {
      'accept': 'application/json',
      'authentication': 'Basic ' + readmeAPIKey
    }
  }

  if (typeof headers !== 'undefined') {
    Object.assign(params.headers, headers)
  }

  if (typeof body !== 'undefined') {
    params.body = body
  }

  return fetch('https://dash.readme.com/api/v1' + path, params)
}

/**
 * Create error message
 * @param {string} message
 * @param {Object} json
 * @returns {string} error message
 */
function createErrorMessage(message, json) {
  return `${message} response:` + JSON.stringify(json, '\t')
}
