import fetch from 'node-fetch';
import { fileFromSync } from 'fetch-blob/from.js'
import { FormData } from 'formdata-polyfill/esm.min.js'

/**
 * Genarate preview link
 */
export async function generatePreview({ github, context, core }) {
  const { GITHUB_HEAD_REF } = process.env;
  const versionId = createVersionIdFrom(GITHUB_HEAD_REF);

  (async () => {
    // ReadMeのバージョンを取得する
    const fetchVersionResponse = await fetchReadMe('GET', `/version/${versionId}`);

    if (fetchVersionResponse.status === 404) {
      // ReadMeのバージョンを作成する
      const createVersionRequestJson = {
        version: versionId,
        codename: GITHUB_HEAD_REF,
        from: 'v2',
        is_stable: false,
        is_beta: false,
        is_hidden: true
      };

      await fetchReadMe('POST', '/version', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(createVersionRequestJson)
      })
        .then(response => Promise.all([response.ok, response.json()]))
        .then(([ok, json]) => {
          if (!ok) {
            return Promise.reject(createErrorMessage('Failed to create version.', json));
          }
        });

      // OpenAPI仕様をアップロードする
      const uploadOpenAPISpecFormData = new FormData();
      uploadOpenAPISpecFormData.append('spec', fileFromSync('./openapi/openapi.yaml'));

      await fetchReadMe('POST', '/api-specification', {
        headers: { 'x-readme-version': versionId },
        body: uploadOpenAPISpecFormData
      })
        .then(response => Promise.all([response.ok, response.json()]))
        .then(([ok, json]) => {
          if (!ok) {
            return Promise.reject(createErrorMessage('Failed to upload OpenAPI Spec.', json));
          }
        });

      return `Preview link is created. here: https://dash.readme.com/hub-go/trackiss?redirect=/${versionId}`;
    } else if (fetchVersionResponse.ok) {
      // 更新対象となるOpenAPI仕様のIDを取得する
      /** @type {string} */
      const openapiSpecId = await fetchReadMe('GET', '/api-specification', {
        headers: { 'x-readme-version': versionId }
      })
        .then(response => Promise.all([response.ok, response.json()]))
        .then(([ok, json]) => ok ? json : Promise.reject(createErrorMessage('Failed to fetch OpenAPI Specs.', json)))
        .then(json => {
          const id = json.filter(spec => spec.title === 'Swagger Petstore')[0]["_id"];

          return (typeof id !== 'undefined') ? id : Promise.reject(
            createErrorMessage('A target OpenAPI Spec does not exist.', fetchOpenAPISpecsResponseJson)
          );
        });

      // OpenAPI仕様を更新する
      const updateOpenAPISpecFormData = new FormData();
      updateOpenAPISpecFormData.append('spec', fileFromSync('./openapi/openapi.yaml'));

      await fetchReadMe('PUT', `/api-specification/${openapiSpecId}`, {
        body: updateOpenAPISpecFormData
      })
        .then(response => Promise.all([response.ok, response.json()]))
        .then(([ok, json]) => {
          if (!ok) {
            return Promise.reject(createErrorMessage('Failed to update OpenAPI Spec.', json));
          }
        });

      return 'Preview link is updated.';
    } else {
      json = await fetchVersionResponse.json();
      return Promise.reject(createErrorMessage('Failed to fetch version.', json));
    }
  })()
    .then(body => github.rest.issues.createComment({
      issue_number: context.issue.number,
      owner: context.repo.owner,
      repo: context.repo.repo,
      body: body
    }))
    .catch(message => {
      core.setFailed(message)
    });
};

/**
 * Delete preview link
 */
export async function deletePreview({ github, context, core }) {
  const versionId = createVersionIdFrom(process.env.GITHUB_HEAD_REF);

  (async () => {
    // ReadMeのバージョンを取得する
    const fetchVersionResponse = await fetchReadMe('GET', `/version/${versionId}`);

    if (fetchVersionResponse.status === 404) {
      // nop
    } else if (fetchVersionResponse.ok) {
      // ReadMeのバージョンを削除する
      await fetchReadMe('DELETE', `/version/${versionId}`)
        .then(response => Promise.all([response.ok, response.json()]))
        .then(([ok, json]) => {
          if (!ok) {
            return Promise.reject(createErrorMessage('Failed to delete version.', json));
          }
        });

      return 'Preview link is deleted.';
    } else {
      json = await fetchVersionResponse.json();
      return Promise.reject(createErrorMessage('Failed to fetch version.', json));
    }
  })()
    .then(body => github.rest.issues.createComment({
      issue_number: context.issue.number,
      owner: context.repo.owner,
      repo: context.repo.repo,
      body: body
    }))
    .catch(message => core.setFailed(message));
}

/**
 * Create ReadMe version ID from current branch name
 * @param {string} branchName 
 * @returns {string} ReadMe version ID
 */
function createVersionIdFrom(branchName) {
  return `v2-${branchName.replace(/[^a-zA-Z0-9]/g, '-')}`;
}

/**
 * fetch with ReadMe.com
 * @param {string} method
 * @param {string} path
 * @param {Object} params
 * @param {string|Blob} body
 * @param {Object} headers
 * @returns {Promise<fetch.Response>} response
 */
function fetchReadMe(method, path, params = {}) {
  const { README_API_KEY } = process.env;

  if (typeof README_API_KEY === 'undefined') {
    return Promise.reject('`README_API_KEY` environment variable is not set.');
  }

  params.method = method;

  const headers = {
    accept: 'application/json',
    authorization: `Basic ${Buffer.from(README_API_KEY).toString('base64')}`
  };

  if (typeof params.headers !== 'undefined') {
    Object.assign(headers, params.headers);
  }

  params.headers = headers;

  return fetch('https://dash.readme.com/api/v1' + path, params);
}

/**
 * Create error message
 * @param {string} message
 * @param {Object} json
 * @returns {string} error message
 */
function createErrorMessage(message, json) {
  return `${message} response: ${JSON.stringify(json, '\t')}`;
}
