import puppeteer from "puppeteer"
import Debug from "debug"
import ky from "ky"
import cheerio from "cheerio"
import chalk from "chalk"
import { QCommentData, QCommentEntry } from "./struct/QCommentEntry.js"

const debug = Debug("qcleaner:util")
const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36"

export const PUNG = "펑"
export const REMOVED = `<p>${PUNG}</p>`
export const qzone = `https://quasarzone.com/`
export type RawCookie = { [key in string]: string }
export const sleep = async (ms: number) => new Promise<void>((res) => ms > 0 ? setTimeout(res, ms) : res())
// type WithCookie<T> = T & { setCookie: RawCookie }

/**
 * 쿠키를 가져옵니다
 * @returns 쿠키
 */
export async function getCookie() {
  const browser = await puppeteer.launch({
    headless: false,
  })

  const page = await browser.newPage()
  page.setJavaScriptEnabled(true)
  page.setUserAgent(userAgent)
  await page.setViewport({ width: 1024, height: 1024 })
  await page.goto(`${qzone}login`)

  await page.waitForRequest(qzone, { timeout: 1000 * 600 })

  const cookie = await page.cookies(qzone)
  await browser.close()

  const rawCookie: RawCookie = {}
  for (const cook of cookie) {
    rawCookie[cook.name] = cook.value
  }
  return rawCookie
}

/**
 * 내 정보를 불러옵니다.
 * @param cookie 쿠키
 * @returns 내 정보
 */
export async function getProfile(cookie: RawCookie) {
  const resp = await ky.get(`${qzone}/users/edit`, {
    headers: {
      "User-Agent": userAgent,
      "Cookie": asCookieString(cookie),
      "Referer": qzone,
    },
  })
  const $ = cheerio.load(await resp.text())
  const profilePic = $(".thumb-pic > img").attr("src") ?? ""
  const nickName = $(".user-nick-wrap").text().trim()
  const userNum = $(".user-nick-wrap").attr("data-row") ?? ""
  const userId = $(".user-nick-wrap").attr("data-id") ?? ""
  const [, planet, exp] = $(".util-area").text().trim().split(/\s+/ig)
  const CSRFToken = $("meta[name='csrf-token']").attr("content") ?? ""

  return {
    setCookie: getSetCookies(resp.headers.getSetCookie()),
    profilePic,
    nickName: nickName.substring(0, nickName.length - 2),
    userNum,
    userId,
    planet,
    exp: Number(exp.match(/\d+/ig)?.join("") ?? "0"),
    CSRFToken,
  }
}

/**
 * 1년 내 범위에서 댓글들을 가져옵니다.
 * @param cookie 쿠키
 * @param myId 내 userId
 * @returns 댓글들
 */
export async function getRecentComments(cookie: RawCookie, myId: string) {
  // https://quasarzone.com/users/board/O1JbnhpqI0lUKkfQJ1X8Rg--/comment
  const baseURL = `${qzone}users/board/${myId}/comment`
  const comments: QComment[] = []
  let page = 1
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const requestURL = `${baseURL}?page=${page}`
    debug(`[Comment] Parsing page ${chalk.green(page)}...`)

    let current = Date.now()
    const resp = await ky.get(requestURL, {
      headers: {
        "User-Agent": userAgent,
        "Cookie": asCookieString(cookie),
        "Referer": baseURL,
      },
    })
    cookie = mergeCookie(cookie, getSetCookies(resp.headers.getSetCookie()))
    await sleep(500 - (Date.now() - current))

    const $ = cheerio.load(await resp.text())
    const rows = $("table > tbody").find("tr")
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]
      const $2 = $($(row).find("a")[0])

      let infoBlock = $2.attr("href") ?? ""
      infoBlock = infoBlock.substring(infoBlock.indexOf("'") + 1, infoBlock.lastIndexOf("'"))
      const infoArr = infoBlock.split("', '")
      comments.push({
        articleTitle: $2.text().trim(),
        boardName: infoArr[0],
        articleId: infoArr[1],
        page: Number(infoArr[2]),
        commentId: infoArr[3],
      })
    }
    if (rows.length < 10) {
      break
    }
    page += 1
    await sleep(100)
  }
  return {
    setCookie: cookie,
    comments,
    pages: page,
  }
}

/**
 * 댓글 ID를 기반으로 댓글을 삭제합니다.
 * 삭제 안 될 가능성이 높습니다.
 * @param cookie 쿠키
 * @param params 댓글 정보
 * @returns 성공 여부
 */
export async function removeComment(cookie: RawCookie,
  params: Omit<QComment, "page">) {

  const baseURL = `${qzone}bbs/${params.boardName}/views/${params.articleId}`
  const reqURL = `${baseURL}/delete/${params.commentId}`
  debug(`[Comment] Removing comment id ${chalk.green(params.commentId)} (articleName: ${chalk.green(params.articleTitle)}, boardName: ${chalk.yellow(params.boardName)}, articleId: ${chalk.yellow(params.articleId)})`)

  const resp = await ky.get(reqURL, {
    headers: {
      "User-Agent": userAgent,
      "Cookie": asCookieString(cookie),
      "Referer": baseURL,
    },
    throwHttpErrors: false,
  })
  cookie = mergeCookie(cookie, getSetCookies(resp.headers.getSetCookie()))

  const success = resp.status === 302
  let failReason = ""
  let mustEdit = false
  let articleRemoved = false
  let tmr = false
  if (!success) {
    if (resp.status === 429) {
      tmr = true
    } else if (resp.status === 200) {
      const doc = await resp.text()
      if (doc.indexOf("<meta") >= 0) {
        articleRemoved = true
        failReason = "게시글이 삭제됨."
      } else {
        failReason = doc.substring(doc.indexOf("alert(") + 7, doc.indexOf(");") - 1)
        mustEdit = failReason.indexOf("답글 작성된 댓글은 삭제할 수 없습니다") >= 0
      }
    } else {
      debug("[RemoveComment] ERROR with code " + chalk.red(resp.status))
    }
  }

  return {
    setCookie: cookie,
    success,
    failReason,
    mustEdit,
    articleRemoved,
    tmr,
  }
}

/**
 * 댓글 ID를 기반으로 댓글을 수정합니다. (펑)
 * @param cookie 쿠키
 * @param csrfToken CSRF 토큰
 * @param params 댓글 정보
 * @returns 성공 여부
 */

export async function explodeComment(cookie: RawCookie, csrfToken: string,
  params: Omit<QComment, "page">) {

  const baseURL = `${qzone}bbs/${params.boardName}/views/${params.articleId}`
  const reqURL = `${qzone}bbs/${params.boardName}/comments/update`

  debug(`[Comment] Exploding comment id ${chalk.green(params.commentId)} (articleName: ${chalk.green(params.articleTitle)}, boardName: ${chalk.yellow(params.boardName)}, articleId: ${chalk.yellow(params.articleId)})`)

  const resp = await ky.post(reqURL, {
    headers: {
      "User-Agent": userAgent,
      "Cookie": asCookieString(cookie),
      "Referer": baseURL,
    },
    body: new URLSearchParams({
      _token: csrfToken,
      writeId: params.articleId,
      commentId: params.commentId,
      commentSort: "old",
      page: "",
      requestUri: `/bbs/${params.boardName}/views/${params.articleId}`,
      _method: "PUT",
      content: REMOVED,
      files: "",
    }),
  })
  cookie = mergeCookie(cookie, getSetCookies(resp.headers.getSetCookie()))

  return {
    setCookie: cookie,
    success: resp.status === 200,
  }
}

/**
 * 특정 게시물의 댓글을 모두 불러옵니다.
 * @param cookie 쿠키
 * @param article 게시글 정보
 * @returns 댓글 목록
 */
export async function fetchComments(cookie: RawCookie, article: QArticle) {
  let totalCount = -1 // 총 댓글 수
  let page = 1;
  const commentsData: QCommentData[] = []
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const baseURL = `${qzone}bbs/${article.boardName}/views/${article.articleId}`
    const reqURL = `${qzone}comments/${article.boardName}/getComment?boardName=${article.boardName}&writeId=${article.articleId}&page=${page}&order=old`

    debug(`[Comment] Fetching page ${chalk.green(page)} of ${chalk.green(article.articleTitle)}`)

    const current = Date.now()
    const resp = await ky.get(reqURL, {
      headers: {
        "User-Agent": userAgent,
        "Cookie": asCookieString(cookie),
        "Referer": baseURL,
      },
    })
    cookie = mergeCookie(cookie, getSetCookies(resp.headers.getSetCookie()))

    const respData = await resp.json() as QCommentEntry
    // 댓글 데이터 처리
    totalCount = respData.comm_cnt
    commentsData.push(...(respData?.comm_list?.comments?.data ?? []))

    // 마무리
    if ((respData?.comm_list?.comments?.last_page ?? -1) <= page) {
      break
    }
    await sleep(500 - (Date.now() - current))
    page += 1
  }

  return {
    setCookie: cookie,
    commentsData,
    totalCount,
  }
}

/**
 * 특정 게시물을 수정합니다. (펑)
 * @param cookie 쿠키
 * @param article 게시글 정보
 * @returns 성공 여부
 */
export async function explodeArticle(cookie: RawCookie, article: QArticle) {
  const baseURL = `${qzone}bbs/${article.boardName}/edit/${article.articleId}`
  const uploadURL = `${qzone}/bbs/${article.boardName}/update/${article.articleId}`

  let current = Date.now()
  const resp = await ky.get(baseURL, {
    headers: {
      "User-Agent": userAgent,
      "Cookie": asCookieString(cookie),
      "Referer": `${qzone}bbs/${article.boardName}/views/${article.articleId}`,
    },
  })
  cookie = mergeCookie(cookie, getSetCookies(resp.headers.getSetCookie()))
  await sleep(800 - (Date.now() - current))

  const $ = cheerio.load(await resp.text())
  const uid = $("#uid").attr("value")
  const ca_name = $("#ca_name :selected").val()
  const csrfToken = $("input[name=_token]").attr("value")

  const formData = new FormData()
  formData.append("queryString", "")
  formData.append("_method", "put")
  formData.append("type", "update")
  formData.append("writeId", article.articleId)
  formData.append("uid", uid)
  formData.append("_token", csrfToken)
  formData.append("ca_name", ca_name)
  formData.append("prevent_best", "1")
  formData.append("widget_prevent_best", "1")
  formData.append("html", "html1")
  formData.append("subject", PUNG)
  formData.append("content", "<p></p>")
  formData.append("files", "")

  const uploadResp = await ky.post(uploadURL, {
    headers: {
      "User-Agent": userAgent,
      "Cookie": asCookieString(cookie),
      "Referer": baseURL,
    },
    body: formData,
  })
  cookie = mergeCookie(cookie, getSetCookies(resp.headers.getSetCookie()))

  return {
    setCookie: cookie,
    success: uploadResp.status === 302,
  }
}

export async function fetchPosts(cookie: RawCookie) {
  let page = 1
  const posts: QPost[] = []
  // eslint-disable-next-line no-constant-condition
  while (true) {
    debug(`[Posts] Fetching page ${chalk.green(page)}...`)

    const current = Date.now()
    const baseURL = `${qzone}users/posts?page=${page}`
    const resp = await ky.get(baseURL, {
      headers: {
        "User-Agent": userAgent,
        "Cookie": asCookieString(cookie),
        "Referer": baseURL,
      },
    })
    cookie = mergeCookie(cookie, getSetCookies(resp.headers.getSetCookie()))
    await sleep(600 - (Date.now() - current))

    const $ = cheerio.load(await resp.text())
    const rows = $("table > tbody").find("tr")
    for (const row of rows) {
      const category = $($(row).find(".cate1")[0]).text()
      const isComment = $($(row).find(".cate2")[0]).text().trim() === "댓글"
      const articleData = $($(row).find("a")[0]).attr("href") ?? ""
      const [boardName, articleId] = articleData.substring(articleData.indexOf("'") + 1, articleData.lastIndexOf("'")).split("', '")
      const articleTitle = $($(row).find("a")[0]).text().trim()

      posts.push({
        category,
        isComment,
        articleId,
        boardName,
        articleTitle,
      })
    }

    if (rows.length < 10) {
      break
    }
    page += 1
  }
  return {
    setCookie: cookie,
    posts,
  }
}



export interface QArticle {
  articleTitle?: string,
  boardName: string,
  articleId: string,
}

export interface QPost extends QArticle {
  category: string,
  isComment: boolean,
}

export interface QComment {
  articleTitle?: string,
  boardName: string,
  articleId: string,
  page: number,
  commentId: string,
}

export function asCookieString(cookie: RawCookie) {
  return Object.entries(cookie).map(([key, value]) => {
    return `${key}=${value}`
  }).join(";")
}

export function getSetCookies(setCookie: string[]) {
  const rawCookie: RawCookie = {}
  const kv = setCookie.map((v) => v.substring(0, v.indexOf(";")))
  for (const data of kv) {
    const pivot = data.indexOf("=")
    rawCookie[data.substring(0, pivot)] = data.substring(pivot + 1)
  }
  return rawCookie
}

export function mergeCookie(oldCookie: RawCookie, setCookie: RawCookie) {
  return {
    ...oldCookie,
    ...setCookie,
  }
}

export function articleToMap(posts: QArticle[]) {
  const output: { [key in string]: Set<string> } = {}

  for (const post of posts) {
    if (output[post.boardName] == null) {
      output[post.boardName] = new Set()
    }
    output[post.boardName].add(post.articleId)
  }

  return output
}