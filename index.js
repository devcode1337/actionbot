// ===== ИМПОРТЫ =====
const { VK } = require('vk-io');
const { HearManager } = require('@vk-io/hear');
const { SessionManager } = require('@vk-io/session');
const { SceneManager, StepScene } = require('@vk-io/scenes');
const connectDB = require('./src/db/connection');
const Auction = require('./src/db/models/auction');
const User = require('./src/db/models/user'); // Добавляем импорт модели User
const { isAdmin, delAuction } = require('./src/commands/auction');
const { getRemainingTime } = require('./src/utils/timeFormatter');
const { showProfile } = require('./src/commands/profile'); // Импортируем функцию профиля
const cron = require('node-cron');

// ===== VK ИНИЦИАЛИЗАЦИЯ =====
const vk = new VK({
    token: 'vk1.a.99cjuu9bSLjmCsDTtVMipdXYHXIMfUl72yjg9spVFIzSWxbt3_zeHznF9M2MPEJAGrkl8hFxL7ECLvSQcATpuRqGRL6Q2Fuy-zTJfpeQPwu_yMY74J__v_k2cyrjVhWxmj5mHIW00IyRgBtMtnnhd51QMZzEBq2rm8Pklnw0Txg5y8aL2rnwWF_4b8gGQSBh_BxTCgm-JhVyUC62f4k76w'
});

// ===== ПОДКЛЮЧЕНИЕ К БД =====
connectDB();

// ===== МЕНЕДЖЕРЫ =====
const hearManager = new HearManager();
const sessionManager = new SessionManager();
const sceneManager = new SceneManager();

// ===== СЦЕНЫ =====
const addAuctionScene = new StepScene('add_auction', [
    async (ctx) => {
        if (ctx.scene.step.firstTime || !ctx.text) {
            return ctx.send('📝 Введите название лота:');
        }
        ctx.scene.state.lotName = ctx.text.trim();
        return ctx.scene.step.next();
    },
    async (ctx) => {
        if (ctx.scene.step.firstTime || !ctx.text) {
            return ctx.send('💰 Введите начальную ставку (число):');
        }
        const startPrice = parseInt(ctx.text, 10);
        if (isNaN(startPrice) || startPrice < 0) {
            await ctx.send('❌ Введите корректное число (0 или больше).');
            return ctx.scene.step.reenter();
        }
        ctx.scene.state.startPrice = startPrice;
        return ctx.scene.step.next();
    },
    async (ctx) => {
        if (ctx.scene.step.firstTime || !ctx.text) {
            return ctx.send('📈 Введите шаг ставки (число > 0):');
        }
        const bidStep = parseInt(ctx.text, 10);
        if (isNaN(bidStep) || bidStep <= 0) {
            await ctx.send('❌ Шаг должен быть числом больше 0.');
            return ctx.scene.step.reenter();
        }
        ctx.scene.state.bidStep = bidStep;
        return ctx.scene.step.next();
    },
    async (ctx) => {
        if (ctx.scene.step.firstTime || !ctx.text) {
            return ctx.send('⏰ Введите длительность аукциона в минуты (число > 0):');
        }
        const duration = parseInt(ctx.text, 10);
        if (isNaN(duration) || duration <= 0) {
            await ctx.send('❌ Длительность должна быть числом больше 0.');
            return ctx.scene.step.reenter();
        }

        try {
            const now = new Date();
            const endTime = new Date(now.getTime() + duration * 60000);

            const lastAuction = await Auction.findOne().sort({ numericId: -1 });
            const nextId = lastAuction && lastAuction.numericId ? lastAuction.numericId + 1 : 1;

            const auction = new Auction({
                numericId: nextId,
                lotName: ctx.scene.state.lotName,
                startPrice: ctx.scene.state.startPrice,
                currentPrice: ctx.scene.state.startPrice,
                bidStep: ctx.scene.state.bidStep,
                endTime,
                finished: false,
                currentWinner: null
            });

            await auction.save();
            const formattedId = String(auction.numericId).padStart(4, '0');

            await vk.api.messages.send({
                peer_id: 2000000005,
                message: `🎉 Аукцион №${formattedId} запущен!
🛒 Лот: ${auction.lotName}
💰 Начальная ставка: ${auction.startPrice}
📈 Шаг ставки: ${auction.bidStep}
⏰ Длительность: ${duration} минут

Ставки через команду: !addvalue ${auction.numericId} [сумма]`,
                random_id: Date.now()
            });

            await ctx.send(`✅ Аукцион "${auction.lotName}" успешно добавлен! ID: №${formattedId}`);
        } catch (err) {
            console.error(err);
            await ctx.send('❌ Ошибка при добавлении аукциона.');
        }
        return ctx.scene.leave();
    }
]);

// Простая сцена редактирования аукциона, чтобы команда !editauk работала
const editAuctionScene = new StepScene('edit_auction', [
    async (ctx) => {
        let { auctionId } = ctx.scene.state;
        if (!auctionId) {
            if (ctx.scene.step.firstTime) {
                return ctx.send('🆔 Введите ID аукциона для редактирования:');
            }
            const id = parseInt(ctx.text, 10);
            if (isNaN(id)) {
                await ctx.send('❌ Введите корректный ID (число).');
                return ctx.scene.step.reenter();
            }
            auctionId = id;
            ctx.scene.state.auctionId = id;
        }

        const auction = await Auction.findOne({ numericId: auctionId });
        if (!auction) {
            await ctx.send(`❌ Аукцион №${String(auctionId).padStart(4, '0')} не найден.`);
            return ctx.scene.leave();
        }
        ctx.scene.state.auction = auction;

        const formattedId = String(auction.numericId).padStart(4, '0');
        await ctx.send(
            `🛠 Редактируем аукцион №${formattedId} (${auction.lotName})
Выберите, что изменить:
1 — Название
2 — Шаг ставки
3 — Установить новую длительность (минуты, от текущего момента)`
        );
        return ctx.scene.step.next();
    },
    async (ctx) => {
        if (!ctx.text) return ctx.scene.step.reenter();
        const choice = parseInt(ctx.text, 10);
        if (![1, 2, 3].includes(choice)) {
            await ctx.send('❌ Введите 1, 2 или 3.');
            return ctx.scene.step.reenter();
        }
        ctx.scene.state.choice = choice;
        if (choice === 1) await ctx.send('✏️ Введите новое название:');
        if (choice === 2) await ctx.send('📈 Введите новый шаг ставки (число > 0):');
        if (choice === 3) await ctx.send('⏰ Введите новую длительность в минутах (число > 0):');
        return ctx.scene.step.next();
    },
    async (ctx) => {
        const auction = ctx.scene.state.auction;
        const choice = ctx.scene.state.choice;

        try {
            if (choice === 1) {
                const name = (ctx.text || '').trim();
                if (!name) {
                    await ctx.send('❌ Название не может быть пустым.');
                    return ctx.scene.step.reenter();
                }
                auction.lotName = name;
            } else if (choice === 2) {
                const step = parseInt(ctx.text, 10);
                if (isNaN(step) || step <= 0) {
                    await ctx.send('❌ Шаг должен быть числом больше 0.');
                    return ctx.scene.step.reenter();
                }
                auction.bidStep = step;
            } else if (choice === 3) {
                const minutes = parseInt(ctx.text, 10);
                if (isNaN(minutes) || minutes <= 0) {
                    await ctx.send('❌ Длительность должна быть числом больше 0.');
                    return ctx.scene.step.reenter();
                }
                const now = new Date();
                auction.endTime = new Date(now.getTime() + minutes * 60000);
            }

            await auction.save();
            const formattedId = String(auction.numericId).padStart(4, '0');
            await ctx.send(`✅ Аукцион №${formattedId} обновлён.`);
        } catch (e) {
            console.error(e);
            await ctx.send('❌ Ошибка при обновлении аукциона.');
        }
        return ctx.scene.leave();
    }
]);

sceneManager.addScenes([addAuctionScene, editAuctionScene]);

// ===== MIDDLEWARES =====
vk.updates.use(sessionManager.middleware);
vk.updates.use(sceneManager.middleware);
vk.updates.use(sceneManager.middlewareIntercept);
vk.updates.use(hearManager.middleware);

// ===== КОМАНДЫ =====
hearManager.hear(/^!profile$/i, async (ctx) => {
    await showProfile(ctx);
});

hearManager.hear(/^!addauk$/i, async (ctx) => {
    if (!await isAdmin(ctx.senderId)) return ctx.send('❌ Команда доступна только администраторам.');
    return ctx.scene.enter('add_auction');
});

hearManager.hear(/^!delauk (\d+)$/i, async (ctx) => {
    if (!await isAdmin(ctx.senderId)) return ctx.send('❌ Команда доступна только администраторам.');
    const auctionId = parseInt(ctx.$match[1], 10);
    await delAuction(ctx, auctionId);
});

hearManager.hear(/^!addvalue (\d+) (\d+)$/i, async (ctx) => {
    const auctionId = parseInt(ctx.$match[1], 10);
    const newPrice = parseInt(ctx.$match[2], 10);

    const auction = await Auction.findOne({ numericId: auctionId });
    if (!auction) return ctx.send(`❌ Аукцион №${String(auctionId).padStart(4, '0')} не найден.`);
    if (auction.finished) return ctx.send(`❌ Аукцион №${String(auctionId).padStart(4, '0')} уже завершён.`);

    if (isNaN(newPrice) || newPrice < auction.currentPrice + auction.bidStep) {
        return ctx.send(`❌ Ставка должна быть выше текущей (${auction.currentPrice}) на шаг (${auction.bidStep}).`);
    }

    try {
        auction.currentPrice = newPrice;
        auction.currentWinner = ctx.senderId;
        await auction.save();

        const formattedId = String(auction.numericId).padStart(4, '0');
        const remainingTime = getRemainingTime(auction.endTime);

        await vk.api.messages.send({
            peer_id: 2000000005,
            message: `💸 Участник сделал ставку на аукцион №${formattedId}: ${newPrice} монет.
⏰ Лот закроется через: ${remainingTime}`,
            random_id: Date.now()
        });

        await ctx.send(`✅ Ставка принята на аукционе №${formattedId}.`);
    } catch (err) {
        console.error(err);
        await ctx.send('❌ Ошибка при ставке.');
    }
});

hearManager.hear(/^!cancellation (\d+)$/i, async (ctx) => {
    const auctionId = parseInt(ctx.$match[1], 10);
    const auction = await Auction.findOne({ numericId: auctionId });

    if (!auction) return ctx.send(`❌ Аукцион №${String(auctionId).padStart(4, '0')} не найден.`);
    if (auction.currentWinner?.toString() !== ctx.senderId.toString()) return ctx.send('❌ Вы не лидер аукциона.');

    auction.currentWinner = null;
    auction.currentPrice = auction.startPrice;
    await auction.save();

    const formattedId = String(auction.numericId).padStart(4, '0');
    await vk.api.messages.send({
        peer_id: 2000000005,
        message: `❌ Лидер аукциона №${formattedId} отменил ставку. Цена возвращена к ${auction.startPrice}.`,
        random_id: Date.now()
    });

    await ctx.send(`✅ Ваша ставка на аукционе №${formattedId} отменена.`);
});

hearManager.hear(/^!editauk (\d+)$/i, async (ctx) => {
    if (!await isAdmin(ctx.senderId)) return ctx.send('❌ Только админы.');
    const auctionId = parseInt(ctx.$match[1], 10);
    return ctx.scene.enter('edit_auction', { auctionId });
});

// ===== КРОН-ПРОВЕРКА АУКЦИОНОВ =====
cron.schedule('* * * * *', async () => {
    try {
        const now = new Date();
        const auctions = await Auction.find({ finished: false, endTime: { $lte: now } });

        for (const auction of auctions) {
            auction.finished = true;
            await auction.save();

            const formattedId = String(auction.numericId).padStart(4, '0');

            if (auction.currentWinner) {
                const userInfo = await vk.api.users.get({ user_ids: auction.currentWinner });
                const userName = `${userInfo[0].first_name} ${userInfo[0].last_name}`;

                await vk.api.messages.send({
                    peer_id: 2000000005,
                    message: `🏆 Аукцион №${formattedId} завершён! Победитель: ${userName} со ставкой ${auction.currentPrice} монет.`,
                    random_id: Date.now()
                });
            } else {
                await vk.api.messages.send({
                    peer_id: 2000000005,
                    message: `⚠️ Аукцион №${formattedId} завершён! Ставок не было.`,
                    random_id: Date.now()
                });
            }
        }
    } catch (e) {
        console.error('Cron error:', e);
    }
});

// ===== ЗАПУСК =====
vk.updates.start().catch(console.error);
console.log('🤖 Бот запущен!');