import { Application, Router } from "https://deno.land/x/oak@v12.1.0/mod.ts";
import "https://deno.land/std@0.179.0/dotenv/load.ts";
import { connect } from "https://deno.land/x/redis/mod.ts";
import { getQuery } from "https://deno.land/x/oak@v12.1.0/helpers.ts";
import * as colors from "https://deno.land/std/fmt/colors.ts";

const redis = await connect({
    hostname: Deno.env.get("REDIS_HOSTNAME") || '',
    port: Deno.env.get("REDIS_PORT") || '',
    username: Deno.env.get("REDIS_USER") || '',
    password: Deno.env.get("REDIS_PASS") || ''
});

const consumer_key = Deno.env.get("CONSUMER_KEY")
let codeAchive = ''
let accessToken = ''
interface IBookmarkResponse {
    item_id: string
    resolved_id: string
    given_url: string
    given_title: string
    time_added: string
}

const router = new Router();
router
    .get("/", (context) => {
        context.response.body = "Hello World";
        context.response.status = 200
    })
    .get("/test-code", (context) => {
        context.response.body = {
            code: codeAchive,
            access_token: accessToken
        };
        context.response.status = 200
    })
    .get("/test-redis-data", async (context) => {
        const bookmarksString = await redis.get("bookmarks")
        // console.log(bookmarksString);
        const template = JSON.parse(bookmarksString || '')
        context.response.body = template;
        context.response.status = 200
    })
    .get("/authen", async (context) => {
        try {
            if (!codeAchive) {
                console.log('on request')
                const getpocketRequestAuth = await fetch('https://getpocket.com/v3/oauth/request', {
                    method: 'POST',
                    body: JSON.stringify({
                        consumer_key,
                        redirect_uri: 'https://www.google.com'
                    }),
                    // important header
                    headers: {
                        'Content-Type': 'application/json; charset=UTF-8',
                        'X-Accept': 'application/json'
                    }
                })
                const { code, state } = await getpocketRequestAuth.json()
                codeAchive = code
            }

            console.log('codeAchive : ', codeAchive)

            const getpocketAuth = await fetch('https://getpocket.com/v3/oauth/authorize', {
                method: 'POST',
                body: JSON.stringify({
                    consumer_key,
                    code: codeAchive
                }),
                headers: {
                    'Content-Type': 'application/json; charset=UTF-8',
                    'X-Accept': 'application/json'
                }
            })
            if (getpocketAuth.status === 403) {
                console.log('case 403')
                const redirectUrl = context.request.url.href;
                console.log(redirectUrl);
                context.response.status = 403
                throw new Error(`https://getpocket.com/auth/authorize?request_token=${codeAchive}&redirect_uri=${Deno.env.get("REDIRECT_URL") || redirectUrl}`);
            }
            if (getpocketAuth.status === 200) {
                console.log('case 200')
                const { access_token } = await getpocketAuth.json();
                accessToken = access_token
                context.response.body = {
                    access_token: access_token
                }
                context.response.status = 200
            }
        } catch (error) {
            context.response.body = {
                message: error.message
            }
        }
    })
    .get("/bookmarks", async (context) => {
        try {
            const { favorite = "1", reset = "0" } = getQuery(context)
            const redisBookmark = await redis.get('bookmarks')
            
            if (redisBookmark && redisBookmark.length && reset === "0") {
                console.info('get bookmark from redis')
                context.response.body = redisBookmark
                context.response.status = 200
                return
            }

            if (!accessToken) {
                throw new Error(`Access Token not found please authen app`);
            }

            const getpocketGet = await fetch('https://getpocket.com/v3/get', {
                method: 'POST',
                body: JSON.stringify({
                    consumer_key,
                    access_token: accessToken,
                    state: "all",
                    sort: "newest",
                    detailType: "simple",
                    favorite
                }),
                // important header
                headers: {
                    'Content-Type': 'application/json; charset=UTF-8',
                    'X-Accept': 'application/json'
                }
            })

            const { list } = await getpocketGet.json()
            const template = {
                bookmark: []
            } as { bookmark: IBookmarkResponse[] }
            const len = Object.keys(list).length
            for (let i = 0; i < len; i++) {
                const { item_id, resolved_id, given_url, given_title, time_added } = list[Object.keys(list)[i]]
                template.bookmark.push({
                    item_id,
                    resolved_id,
                    given_url,
                    given_title,
                    time_added,
                })
            }
            // set key on redis cache 5 min 
            redis.set('bookmarks', JSON.stringify(template), {
                ex: 5 * 60
            })
            context.response.status = 200
            context.response.body = template

        } catch (error) {
            context.response.body = {
                message: error.message
            }
            context.response.status = 400
        }
    })

const app = new Application();
// for logger only
app.use(async (ctx, next) => {
    await next();
    const c = ctx.response.status >= 500
      ? colors.red
      : ctx.response.status >= 400
      ? colors.yellow
      : colors.green;
    console.log(
      `${c(ctx.request.method)} ${c(`(${ctx.response.status})`)} - ${
        colors.cyan(`${ctx.request.url.pathname}${ctx.request.url.search}`)
      }`,
    );
  });

app.use(router.routes());
app.use(router.allowedMethods());


await app.listen({ port: 8000 });