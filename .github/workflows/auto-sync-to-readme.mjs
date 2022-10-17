import fetch from 'node-fetch';
import { fileFromSync } from 'fetch-blob/from.js'
import { FormData } from 'formdata-polyfill/esm.min.js'
import stream from 'node:stream';

export async function generatePreview({ github, context, core }) {
  const { GITHUB_HEAD_REF } = process.env;

  const versionId = convertToSemVer(`v2-${GITHUB_HEAD_REF}-2`);

  (async () => {
    // ReadMeのバージョンを取得する
    const fetchVersionResponse = await fetchReadMe('GET', `/version/${versionId}`);

    if (fetchVersionResponse.status === 404) {
      // ReadMeのバージョンを作成する
      const createVersionRequestJson = {
        'version': versionId,
        'codename': GITHUB_HEAD_REF,
        'from': 'v2',
        'is_stable': false,
        'is_beta': false,
        'is_hidden': true
      }

      await fetchReadMe('POST', '/version', JSON.stringify(createVersionRequestJson), {
        'content-type': 'application/json'
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

      await fetchReadMe('POST', '/api-specification', uploadOpenAPISpecFormData, { 'x-readme-version': versionId })
        .then(response => Promise.all([response.ok, response.json()]))
        .then(([ok, json]) => {
          if (!ok) {
            return Promise.reject(createErrorMessage('Failed to upload OpenAPI Spec.', json));
          }
        })
    } else if (fetchVersionResponse.ok) {
      // 更新対象となるOpenAPI仕様のIDを取得する
      /** @type {string} */
      const openapiSpecId = await fetchReadMe('GET', `/version/${versionId}`)
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

      await fetchReadMe('PUT', `/api-specification/${openapiSpecId}`, updateOpenAPISpecFormData)
        .then(response => Promise.all([response.ok, response.json()]))
        .then(([ok, json]) => {
          if (!ok) {
            return Promise.reject(createErrorMessage('Failed to update OpenAPI Spec.', json));
          }
        });
    } else {
      json = await fetchVersionResponse.json();
      return Promise.reject(createErrorMessage('Failed to fetch version.', json));
    }
  })()
    .then(() => github.rest.issues.createComment({
      issue_number: context.issue.number,
      owner: context.repo.owner,
      repo: context.repo.repo,
      body: `Preview link here: https://dash.readme.com/hub-go/trackiss?redirect=/${versionId}`
    }))
    .catch(message => core.setFailed(message));
};

/**
 * Convert to a string compatible with Semantic Versioning
 * @param {string} str
 * @returns {string} string compatible with Semantic Versioning
 */
function convertToSemVer(str) {
  return str.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * fetch with ReadMe.com
 * @param {string} method
 * @param {string} path
 * @param {string|stream.Readable} body
 * @param {Object} headers
 * @returns {Promise<fetch.Response>} response
 */
function fetchReadMe(method, path, body, headers) {
  const { README_API_KEY } = process.env;

  if (typeof README_API_KEY === 'undefined') {
    return Promise.reject('`README_API_KEY` environment variable is not set.');
  }

  const params = {
    method: method,
    headers: {
      'accept': 'application/json',
      'authorization': `Basic ${Buffer.from(README_API_KEY).toString('base64')}`
    }
  };

  if (typeof body !== 'undefined') {
    params.body = body;
  }

  if (typeof headers !== 'undefined') {
    Object.assign(params.headers, headers);
  }

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
