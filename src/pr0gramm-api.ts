import { CookieJar, jar as createCookieJar, get as getRequest, post as postRequest } from "request";
import * as Response from "./responses";
import * as Types from "./common-types";
import { Agent } from "http";
import * as constants from "./client-constants";

/**
 * A set of APIs to interact with pr0gramm. Its design is based on the API the site uses.
 */
export class Pr0grammAPI {

	public readonly items: Pr0grammItemsService;
	public readonly tags: Pr0grammTagsService;
	public readonly comments: Pr0grammCommentsService;
	public readonly profile: Pr0grammProfileService;
	public readonly contact: Pr0grammContactService;
	public readonly user: Pr0grammUserService;

	private readonly _requester: APIRequester;

	public get cookies(): CookieJar | false { return this._requester.cookies; }
	public set cookies(v: CookieJar | false) { this._requester.cookies = v; }

	/**
	 * @param cookies Pass false to ignore cookies. Pass a CookieJar to use cookies. If a falsy value (except false, of course) is passed, a new CookieJar will be created internally.
	 * @param _insecure Use the insecure (non-https) protocol.
	 */
	private constructor(requester: APIRequester) {
		this._requester = requester;
		this.items = new Pr0grammItemsService(requester);
		this.tags = new Pr0grammTagsService(requester);
		this.comments = new Pr0grammCommentsService(requester);
		this.profile = new Pr0grammProfileService(requester);
		this.contact = new Pr0grammContactService(requester);
		this.user = new Pr0grammUserService(requester);
	}

	public static createWithRequester(requester: APIRequester): Pr0grammAPI {
		const res = new Pr0grammAPI(requester);
		return res;
	}
	public static createWithCookies(cookies?: CookieJar | false, insecure?: boolean) {
		const cs = cookies === false ? false : (cookies ? cookies : createCookieJar());
		const req = new APIRequester(cs as CookieJar | false, !!insecure);
		const res = new Pr0grammAPI(req);
		return res;
	}
}

/**
 * Class used to fire HTTP(S) requests.
 */
export class APIRequester {
	private readonly _apiUrl: string;
	private static readonly _headers = APIRequester.createDefaultHeaders();
	private readonly _pool: undefined | Agent;

	/**
	 * @param cookies Pass false to ignore cookies. Pass a CookieJar to use cookies.
	 * @param _insecure Use the insecure (non-https) protocol.
	 */
	constructor(public cookies: CookieJar | false, private readonly _insecure: boolean, pool?: Agent) {
		this._apiUrl = constants.getAPIBaseAddress(_insecure);
		this._pool = pool;
	}

	public get<T>(path: string, data?: Types.KeyValue<any>): Promise<T> {
		const url = this._apiUrl + path;
		return new Promise<T>((resolve, reject) => {
			getRequest(url, {
				pool: this._pool,
				qs: data || {},
				headers: APIRequester._headers,
				jar: this.cookies,
				json: true,
			}, (err, response, body) => {
				if (err) return reject(err);
				if (response.statusCode === 200) return resolve(body);
			});
		});
	}
	public post<T>(path: string, data?: Types.KeyValue<any>, ignoreNonce: boolean = false): Promise<T> {
		const url = this._apiUrl + path;
		data = data || {};
		if (!ignoreNonce) {
			const meCookie = this.getMeCookie(this._insecure);
			if (meCookie === null || !meCookie.id)
				throw `Not logged in. The post request to ${path} requires authentication.`;
			data["_nonce"] = meCookie.id.substr(0, 16);
		}

		return new Promise<T>((resolve, reject) => {
			postRequest(url, {
				pool: this._pool,
				form: data,
				headers: APIRequester._headers,
				jar: this.cookies,
				json: true,
			}, (err, response, body) => {
				if (err) return reject(err);
				if (response.statusCode === 200) return resolve(body);
			});
		});
	}
	private getMeCookie(insecure: boolean): Types.MeCookie | null {
		const addr = constants.getBaseAddress(insecure);
		const thisCookies = this.cookies;
		if (thisCookies === false)
			return null;
		const cs = thisCookies.getCookies(addr);
		for (const c of cs) {
			if (!c) continue;
			// TODO DANGEROUS
			// But there are no good definitions for request's cookies :(
			const ct = c as any as { key: string, value: string };
			if (ct.key === "me") {
				const meCookeStr = decodeURIComponent(ct.value);
				try {
					return JSON.parse(meCookeStr);
				}
				catch (ex) {
					return null;
				}
			}
		}
		return null;
	}


	public static createTagList(tags: Types.Tag[]): Types.TagList {
		return tags.join(",");
	}

	private static createDefaultHeaders() {
		return {
			"User-Agent": constants.getUserAgent()
		};
	}
}

export class Pr0grammItemsService {
	constructor(private readonly _requester: APIRequester) {
	}

	public delete(options: DeleteItemOptions): Promise<Response.Pr0grammResponse> {
		const path = `/items/delete`;
		return this._requester.post(path, options);
	}

	public getInfo(itemId: Types.ItemID): Promise<Response.GetItemsInfoResponse> {
		const path = `/items/info`;
		return this._requester.get(path, { itemId });
	}

	public getItems(options: GetItemsOptions): Promise<Response.GetItemsResponse> {
		const path = `/items/get`;
		const rawOptions = Pr0grammItemsService.parseRawGetItemsOptions(options);
		return this._requester.get<Response.GetItemsResponse>(path, rawOptions);
	}
	public getItemsNewer(options: GetItemsNewerOptions): Promise<Response.GetItemsResponse> {
		const path = `/items/get`;
		const rawOptions = {
			newer: options.newer,
			...Pr0grammItemsService.parseRawGetItemsOptions(options)
		};
		return this._requester.get(path, rawOptions);
	}
	public getItemsOlder(options: GetItemsOlderOptions): Promise<Response.GetItemsResponse> {
		const path = `/items/get`;
		const rawOptions = {
			older: options.older,
			...Pr0grammItemsService.parseRawGetItemsOptions(options)
		};
		return this._requester.get(path, rawOptions);
	}
	public getItemsAround(options: GetItemsAroundOptions): Promise<Response.GetItemsResponse> {
		const path = `/items/get`;
		const rawOptions = {
			id: options.around,
			...Pr0grammItemsService.parseRawGetItemsOptions(options)
		};
		return this._requester.get(path, rawOptions);
	}

	public walkStreamNewer(options: GetItemsNewerOptions): AsyncIterableIterator<Types.Item> {
		return this.walkStream(
			options.newer,
			options, {
				getNextId: res => res.items[res.items.length - 1].id,
				shouldContinue: res => !res.atStart,
				getItems: (opts, currentId) => this.getItemsNewer({ ...opts, newer: currentId }),
			}
		);
	}
	public walkStreamOlder(options: GetItemsOlderOptions): AsyncIterableIterator<Types.Item> {
		return this.walkStream(
			options.older,
			options, {
				getNextId: res => res.items[res.items.length - 1].id,
				shouldContinue: res => !res.atEnd,
				getItems: (opts, currentId) => this.getItemsOlder({ ...opts, older: currentId }),
			}
		);
	}

	public async *walkStream(start: Types.ItemID, options: GetItemsOptions, functions: WalkStreamFunctions): AsyncIterableIterator<Types.Item> {
		const fns = { ...functions }; // defensive copy

		let currentId = start;
		let lastCurrentId: Types.ItemID;

		let response: Response.GetItemsResponse | null = null;
		do {
			response = await fns.getItems(options, currentId);

			const items = response.items;
			if (!items || items.length <= 0)
				break;

			yield* items;

			lastCurrentId = currentId;
			currentId = fns.getNextId(response);

			if (lastCurrentId === currentId)
				break;

		} while (fns.shouldContinue(response));
	}

	private static parseRawGetItemsOptions(options: GetItemsOptions) {
		return {
			flags: options.flags,
			promoted: options.promoted ? 1 : 0,

			self: options.self ? 1 : 0,
			tags: options.tags ? APIRequester.createTagList(options.tags) : undefined,
			user: options.user,
			likes: options.likes,
		};
	}

	public vote(id: Types.ItemID, absoluteVote: Types.Vote): Promise<Response.Pr0grammResponse> {
		const path = `/items/vote`;
		const data = {
			id,
			vote: absoluteVote,
		};
		return this._requester.post(path, data);
	}
	public rateLimited(): Promise<Response.Pr0grammResponse> {
		const path = `/items/ratelimited`;
		return this._requester.post(path);
	}

	// TODO:
	// items/post
	// items/info
}

export interface DeleteItemOptions {
	itemId: Types.ItemID;
	days: number;
	banUser: boolean;
	notifyUser: boolean;
	reason: Types.DeleteItemReason;
	customReason: string;
}

export interface GetItemsOptions {
	flags: Types.ItemFlags;
	promoted: boolean;

	// TODO: Split this into different types
	self?: boolean;
	tags?: Types.Tag[];
	user?: Types.Username;
	likes?: Types.Likes;
}
export interface GetItemsNewerOptions extends GetItemsOptions {
	newer: Types.ItemID;
}
export interface GetItemsOlderOptions extends GetItemsOptions {
	older: Types.ItemID;
}
export interface GetItemsAroundOptions extends GetItemsOptions {
	around: Types.ItemID;
}
export interface WalkStreamNewerOptions extends GetItemsNewerOptions {
	end?: Types.ItemID;
}
export interface WalkStreamFunctions {
	getNextId(response: Response.GetItemsResponse): Types.ItemID;
	shouldContinue(response: Response.GetItemsResponse): boolean;
	getItems(options: GetItemsOptions, currentId: Types.ItemID): Promise<Response.GetItemsResponse>;
}

export class Pr0grammProfileService {
	constructor(private readonly _requester: APIRequester) {
	}

	public getCommentsBefore(name: Types.Username, flags: Types.ItemFlags, before: Types.Timestamp): Promise<Response.GetCommentsResponse> {
		const path = `/profile/comments`;
		return this._requester.get(path, {
			name,
			flags,
			before: ensureUnixTimetamp(before),
		});
	}
	public getCommentsAfter(name: Types.Username, flags: Types.ItemFlags, after: Types.Timestamp): Promise<Response.GetCommentsResponse> {
		const path = `/profile/comments`;
		return this._requester.get(path, {
			name,
			flags,
			after: ensureUnixTimetamp(after),
		});
	}

	public follow(name: Types.Username): Promise<Response.Pr0grammResponse> {
		const path = `/profile/follow`;
		return this._requester.post(path, { name });
	}
	public unfollow(name: Types.Username): Promise<Response.Pr0grammResponse> {
		const path = `/profile/unfollow`;
		return this._requester.post(path, { name });
	}

	public getInfo(name: Types.Username, flags: Types.ItemFlags): Promise<Response.GetProfileInfoResponse> {
		const path = `/profile/info`;
		return this._requester.get(path, { name, flags });
	}
}

export class Pr0grammCommentsService {
	constructor(private readonly _requester: APIRequester) {
	}

	public delete(id: Types.CommentID, reason: string): Promise<Response.Pr0grammResponse> {
		const path = `/comments/delete`;
		return this._requester.post(path, { id, reason });
	}
	public softDelete(id: Types.CommentID, reason: string): Promise<Response.Pr0grammResponse> {
		const path = `/comments/softDelete`;
		return this._requester.post(path, { id, reason });
	}
	public edit(id: Types.CommentID, newContent: string): Promise<Response.Pr0grammResponse> {
		const path = `/comments/edit`;
		return this._requester.post(path, { commentId: id, comment: newContent });
	}

	public vote(id: Types.CommentID, absoluteVote: Types.Vote): Promise<Response.Pr0grammResponse> {
		const path = `/comments/vote`;
		return this._requester.post(path, { id, vote: absoluteVote, });
	}

	public post(itemId: Types.ItemID, content: string, replyTo: Types.CommentID = 0): Promise<Response.Pr0grammResponse> {
		const path = `/comments/post`;
		return this._requester.post(path, {
			comment: content,
			itemId,
			parentId: replyTo,
		});
	}
}

export class Pr0grammTagsService {
	constructor(private readonly _requester: APIRequester) {
	}

	public add(itemId: Types.ItemID, tags: Types.Tag[]): Promise<Response.Pr0grammResponse> {
		const path = `/tags/add`;
		return this._requester.post(path, {
			itemId,
			tags: APIRequester.createTagList(tags),
			submit: "Tags speichern",
		});
	}

	public delete(itemId: Types.ItemID, banUsers: boolean, days: Types.BanDuration, tags: Types.Tag[]): Promise<Response.Pr0grammResponse> {
		const path = `/tags/delete`;
		return this._requester.post(path, { itemId, tags, banUsers, days });
	}

	public getDetails(itemId: Types.ItemID): Promise<Response.GetDetailsResponse> {
		const path = `/tags/details`;
		return this._requester.get(path, { itemId });
	}

	public vote(id: Types.TagID, absoluteVote: Types.Vote): Promise<Response.Pr0grammResponse> {
		const path = `/tags/vote`;
		return this._requester.post(path, { id, vote: absoluteVote });
	}
}

export class Pr0grammContactService {
	constructor(private readonly _requester: APIRequester) {
	}

	public send(email: Types.Email, subject: string, message: string): Promise<Response.Pr0grammResponse> {
		const path = `/contact/send`;
		return this._requester.post(path, { email, subject, message });
	}
}

export class Pr0grammMessageService {
	constructor(private readonly _requester: APIRequester) {
	}

	public getConversations(): Promise<Response.ConversationResponse> {
		const path = `/inbox/conversations`;
		return this._requester.get(path);
	}

	public getConversationsOlder(older: Types.ConversationID): Promise<Response.ConversationResponse> {
		const path = `/inbox/conversations`;
		return this._requester.get(path, { older });
	}

	public getMessages(user: Types.Username): Promise<Response.MessagesResponse> {
		const path = `/inbox/messages`;
		return this._requester.get(path, { with: user });
	}

	public sendMessage(recipientName: Types.Username, comment: Types.MessageComment): Promise<Response.MessagesResponse> {
		const path = `/inbox/post`;
		return this._requester.post(path, { recipientName, comment });
	}
}

export class Pr0grammUserService {
	constructor(private readonly _requester: APIRequester) {
	}

	public ban(user: Types.Username, reason: string, days: Types.BanDuration): Promise<Response.Pr0grammResponse> {
		const path = `/user/ban`;
		return this._requester.post(path, { user, reason, days });
	}
	public changeEmail(token: Types.ChangeEmailToken): Promise<Response.ChangeUserDataResponse> {
		const path = `/user/changeemail`;
		return this._requester.post(path, { token });
	}
	public changePassword(newPassword: Types.Password): Promise<Response.ChangeUserDataResponse> {
		const path = `/user/changepassword`;
		return this._requester.post(path, { password: newPassword });
	}

	public getFollowList(flags: Types.ItemFlags): Promise<Response.GetFollowListReponse> {
		const path = `/user/followlist`;
		return this._requester.get(path, { flags });
	}

	public getInfo(): Promise<Response.GetUserInfoResponse> {
		const path = `/user/info`;
		return this._requester.get(path);
	}

	public invite(email: Types.Email): Promise<Response.ChangeUserDataResponse> {
		const path = `/user/invite`;
		return this._requester.post(path, { email });
	}

	/**
	 * ????
	 */
	public joinWithInvite(token: Types.InviteToken, email: Types.Email, password: Types.Password, name: Types.Username): Promise<Response.ChangeUserDataResponse> {
		const path = `/user/joinwithinvite`;
		return this._requester.post(path, { token, email, password, name });
	}
	/**
	 * ????
	 */
	public joinWithToken(token: Types.InviteToken, email: Types.Email, password: Types.Password, name: Types.Username): Promise<Response.TokenResponse> {
		const path = `/user/joinwithtoken`;
		return this._requester.post(path, { token, email, password, name });
	}

	public loadInvite(token: Types.InviteToken): Promise<Response.LoadInviteResponse> {
		const path = `/user/loadinvite`;
		return this._requester.get(path, { token });
	}

	public loadPaymentToken(token: Types.PaymentToken): Promise<Response.TokenInfoResponse> {
		const path = `/user/loadpaymenttoken`;
		return this._requester.post(path, { token });
	}

	public login(name: Types.Username, password: Types.Password): Promise<Response.LogInResponse> {
		const path = `/user/login`;
		return this._requester.post(path, { name, password }, true);
	}

	public logout(id: Types.SessionID): Promise<Response.Pr0grammResponse> {
		const path = `/user/logout`;
		return this._requester.post(path, { id });
	}

	/**
	 * ????
	 */
	public redeemToken(token: Types.InviteToken): Promise<Response.TokenResponse> {
		const path = `/user/redeemtoken`;
		return this._requester.post(path, { token });
	}

	public requestEmailChange(newEmail: Types.Email): Promise<Response.ChangeUserDataResponse> {
		const path = `/user/requestemailchange`;
		return this._requester.post(path, { email: newEmail });
	}

	public resetPassword(name: Types.Username, password: Types.Password, token: Types.ChangePasswordToken): Promise<Response.ChangeUserDataResponse> {
		const path = `/user/resetpassword`;
		return this._requester.post(path, { name, password, token });
	}

	public sendPasswordResetMail(email: Types.Email): Promise<Response.Pr0grammResponse> {
		const path = `/user/sendpasswordresetmail`;
		return this._requester.post(path, { email }, true);
	}

	public setSiteSettings(siteSettings: SiteSettingsOptions): Promise<Response.ChangeUserDataResponse> {
		const path = `/user/sitesettings`;
		const options = {
			likesArePublic: siteSettings.likesArePublic,
			showAds: siteSettings.showAds,
			userStatus: "um" + siteSettings.userStatus
		};
		return this._requester.post(path, options);
	}

	public sync(offset: Types.SyncID): Promise<Response.SyncResponse> {
		const path = `/user/sync`;
		return this._requester.get(path, { offset });
	}

	public validate(token: Types.Token): Promise<Response.SuccessableResponse> {
		const path = `/user/validate`;
		return this._requester.post(path, { token });
	}
}

export interface SiteSettingsOptions {
	likesArePublic: boolean;
	showAds: boolean;
	userStatus: Types.UserMark;
}


function ensureUnixTimetamp(v: Types.Timestamp): Types.UnixTimestamp {
	"use asm"; // Maximum micro optimization
	if (typeof v === "number")
		return v | 0;
	return (v.getTime() / 1000) | 0;
}
